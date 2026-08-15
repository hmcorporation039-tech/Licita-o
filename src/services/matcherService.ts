// ============================================================
// services/matcherService.ts — Cruza licitações com itens monitorados
//
// Critério principal: a palavra-chave precisa aparecer LITERALMENTE no
// objeto da licitação (ou na descrição de algum item), ignorando
// maiúsculas/acentos e respeitando borda de palavra (para "cat6" não
// "achar" dentro de "cateterismo", por exemplo).
//
// Antes usávamos similaridade de trigramas (pg_trgm/word_similarity),
// mas isso mede sobreposição de fragmentos de 3 letras — não se a
// palavra realmente aparece no texto — e gerava muito falso positivo
// com palavras-chave curtas/técnicas (ex: "cat6" batendo com
// "cateterismo cardíaco", "medicamentos" batendo com "equipamento
// médico" por causa do sufixo "-mento" em comum).
// ============================================================

import { prisma } from './tenderService'
import { haversineKm, normalize } from '../lib/geoService'

// Score alto pra casamento por palavra-chave; máximo reservado pro
// casamento exato de código CATMAT/CATSER, o sinal mais forte possível.
const KEYWORD_MATCH_SCORE = 0.9
const CODE_MATCH_SCORE = 1

export interface MatchCandidate {
  monitoredItemId: string
  userId: string
  score: number
  matchedKeywords: string[]
}

// Constrói um regex de borda de palavra a partir de uma keyword, já
// normalizada (minúscula, sem acento) e com os caracteres especiais de
// regex escapados — para poder tratar a keyword como texto literal.
function buildKeywordRegex(keyword: string): RegExp | null {
  const norm = normalize(keyword).trim()
  if (!norm) return null
  const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`)
}

function keywordFoundIn(regex: RegExp, objetoNorm: string, itemDescsNorm: string[]): boolean {
  return regex.test(objetoNorm) || itemDescsNorm.some((d) => regex.test(d))
}

// Filtro por órgão — mesmo casamento literal/borda de palavra das keywords,
// mas funciona como um portão (igual UF/modalidade): se configurado, o órgão
// da licitação precisa bater com algum dos filtros pra ela nem entrar na
// contagem de score. Cada entrada pode ser um nome específico ("PREFEITURA
// MUNICIPAL DE UBERLÂNDIA") ou uma categoria ("PREFEITURA", "UNIVERSIDADE").
function orgaoMatches(orgaos: string[], tenderOrgao: string | null): boolean {
  if (orgaos.length === 0) return true
  if (!tenderOrgao) return false
  const orgaoNorm = normalize(tenderOrgao)
  return orgaos.some((o) => {
    const re = buildKeywordRegex(o)
    return re ? re.test(orgaoNorm) : false
  })
}

export async function findMatchCandidates(tenderId: string): Promise<MatchCandidate[]> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: { items: true },
  })
  if (!tender) return []

  const valorEstimado = tender.valorEstimado ? Number(tender.valorEstimado) : null
  const objetoNorm = normalize(tender.objeto)
  const itemDescsNorm = tender.items.map((i) => normalize(i.descricao))

  const monitoredItems = await prisma.monitoredItem.findMany({ where: { active: true } })

  const candidates: MatchCandidate[] = []

  for (const mi of monitoredItems) {
    if (mi.ufs.length > 0 && (!tender.uf || !mi.ufs.includes(tender.uf))) continue
    if (mi.valorMin != null && valorEstimado != null && Number(mi.valorMin) > valorEstimado) continue
    if (mi.valorMax != null && valorEstimado != null && Number(mi.valorMax) < valorEstimado) continue
    if (mi.modalidades.length > 0 && !mi.modalidades.includes(tender.modalidade)) continue
    if (!orgaoMatches(mi.orgaos, tender.orgao)) continue
    if (mi.raioKm != null) {
      if (mi.origemLat == null || mi.origemLng == null || tender.municipioLat == null || tender.municipioLng == null)
        continue
      if (haversineKm(mi.origemLat, mi.origemLng, tender.municipioLat, tender.municipioLng) > mi.raioKm) continue
    }

    const matchedKeywords = mi.keywords.filter((kw) => {
      const re = buildKeywordRegex(kw)
      return re ? keywordFoundIn(re, objetoNorm, itemDescsNorm) : false
    })

    const codeMatch = tender.items.some(
      (ti) =>
        (ti.catmatCode && mi.catmatCodes.includes(ti.catmatCode)) ||
        (ti.catserCode && mi.catserCodes.includes(ti.catserCode))
    )

    if (matchedKeywords.length === 0 && !codeMatch) continue

    candidates.push({
      monitoredItemId: mi.id,
      userId: mi.userId,
      score: codeMatch ? CODE_MATCH_SCORE : KEYWORD_MATCH_SCORE,
      matchedKeywords,
    })
  }

  return candidates
}

export interface RematchInput {
  keywords: string[]
  catmatCodes: string[]
  catserCodes: string[]
  ufs: string[]
  modalidades: string[]
  orgaos: string[]
  valorMin: number | null
  valorMax: number | null
  raioKm: number | null
  origemLat: number | null
  origemLng: number | null
}

export interface RematchCandidate {
  tenderId: string
  score: number
  matchedKeywords: string[]
}

// Direção inversa do matching: dado um item monitorado (geralmente um recém-cadastrado),
// varre as licitações já coletadas nos últimos `sinceDays` dias em busca de coincidências —
// evita que o usuário precise esperar o próximo ciclo de coleta para ver resultados.
export async function findMatchingTendersForItem(
  item: RematchInput,
  sinceDays = 90
): Promise<RematchCandidate[]> {
  const { keywords, catmatCodes, catserCodes, ufs, modalidades, orgaos, valorMin, valorMax, raioKm, origemLat, origemLng } =
    item

  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
  const tenders = await prisma.tender.findMany({
    where: { createdAt: { gte: cutoff } },
    include: { items: true },
  })

  const keywordPatterns = keywords
    .map((keyword) => ({ keyword, regex: buildKeywordRegex(keyword) }))
    .filter((k): k is { keyword: string; regex: RegExp } => k.regex !== null)

  const results: RematchCandidate[] = []

  for (const t of tenders) {
    if (ufs.length > 0 && (!t.uf || !ufs.includes(t.uf))) continue
    const valorEstimado = t.valorEstimado ? Number(t.valorEstimado) : null
    if (valorMin != null && valorEstimado != null && valorMin > valorEstimado) continue
    if (valorMax != null && valorEstimado != null && valorMax < valorEstimado) continue
    if (modalidades.length > 0 && !modalidades.includes(t.modalidade)) continue
    if (!orgaoMatches(orgaos, t.orgao)) continue
    if (raioKm != null) {
      if (origemLat == null || origemLng == null || t.municipioLat == null || t.municipioLng == null) continue
      if (haversineKm(origemLat, origemLng, t.municipioLat, t.municipioLng) > raioKm) continue
    }

    const objetoNorm = normalize(t.objeto)
    const itemDescsNorm = t.items.map((i) => normalize(i.descricao))

    const matchedKeywords = keywordPatterns
      .filter(({ regex }) => keywordFoundIn(regex, objetoNorm, itemDescsNorm))
      .map(({ keyword }) => keyword)

    const codeMatch = t.items.some(
      (ti) =>
        (ti.catmatCode && catmatCodes.includes(ti.catmatCode)) ||
        (ti.catserCode && catserCodes.includes(ti.catserCode))
    )

    if (matchedKeywords.length === 0 && !codeMatch) continue

    results.push({ tenderId: t.id, score: codeMatch ? CODE_MATCH_SCORE : KEYWORD_MATCH_SCORE, matchedKeywords })
  }

  return results
}
