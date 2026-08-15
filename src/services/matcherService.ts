// ============================================================
// services/matcherService.ts — Cruza licitações com itens monitorados
// Usa pg_trgm (word_similarity) para busca fuzzy + match exato de CATMAT/CATSER
// Pré-requisito: CREATE EXTENSION pg_trgm (ver README passo 6)
//
// Usamos word_similarity(palavra, texto) em vez de similarity(a, b): a segunda
// mede o quão parecidos SÃO os dois textos INTEIROS (ruim aqui — uma keyword
// curta contra um objeto de licitação de 200+ caracteres sempre dá score baixo,
// mesmo quando a palavra aparece líteralmente no texto). word_similarity mede
// o quão bem a palavra encaixa em ALGUM trecho do texto, que é o que queremos.
// ============================================================

import { prisma } from './tenderService'

const SIMILARITY_THRESHOLD = 0.4

export interface MatchCandidate {
  monitoredItemId: string
  userId: string
  score: number
  matchedKeywords: string[]
}

interface FuzzyRow {
  monitoredItemId: string
  userId: string
  score: number
  matchedKeywords: string[] | null
}

interface CodeRow {
  monitoredItemId: string
  userId: string
}

export async function findMatchCandidates(tenderId: string): Promise<MatchCandidate[]> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: { objeto: true, uf: true, valorEstimado: true, municipioLat: true, municipioLng: true, modalidade: true },
  })
  if (!tender) return []

  const valorEstimado = tender.valorEstimado ? Number(tender.valorEstimado) : null

  const fuzzyMatches = await prisma.$queryRaw<FuzzyRow[]>`
    WITH kw AS (
      SELECT mi.id, mi.user_id AS "userId", unnest(mi.keywords) AS keyword
      FROM monitored_items mi
      WHERE mi.active = true
        AND (cardinality(mi.ufs) = 0 OR ${tender.uf}::text = ANY(mi.ufs))
        AND (mi.valor_min IS NULL OR ${valorEstimado}::numeric IS NULL OR mi.valor_min <= ${valorEstimado}::numeric)
        AND (mi.valor_max IS NULL OR ${valorEstimado}::numeric IS NULL OR mi.valor_max >= ${valorEstimado}::numeric)
        AND (cardinality(mi.modalidades) = 0 OR ${tender.modalidade}::text = ANY(mi.modalidades))
        AND (
          mi.raio_km IS NULL
          OR (
            mi.origem_lat IS NOT NULL AND ${tender.municipioLat}::float IS NOT NULL
            AND 6371 * acos(LEAST(1, GREATEST(-1,
              cos(radians(mi.origem_lat)) * cos(radians(${tender.municipioLat}::float)) * cos(radians(${tender.municipioLng}::float) - radians(mi.origem_lng))
              + sin(radians(mi.origem_lat)) * sin(radians(${tender.municipioLat}::float))
            ))) <= mi.raio_km
          )
        )
    ),
    scored AS (
      SELECT kw.id, kw."userId", kw.keyword,
        GREATEST(
          word_similarity(kw.keyword, ${tender.objeto}),
          COALESCE(
            (SELECT MAX(word_similarity(kw.keyword, ti.descricao)) FROM tender_items ti WHERE ti.tender_id = ${tenderId}),
            0
          )
        ) AS sim
      FROM kw
    )
    SELECT id AS "monitoredItemId", "userId",
      MAX(sim)::float AS score,
      array_agg(DISTINCT keyword) FILTER (WHERE sim >= ${SIMILARITY_THRESHOLD}) AS "matchedKeywords"
    FROM scored
    GROUP BY id, "userId"
    HAVING MAX(sim) >= ${SIMILARITY_THRESHOLD}
  `

  const codeMatches = await prisma.$queryRaw<CodeRow[]>`
    SELECT DISTINCT mi.id AS "monitoredItemId", mi.user_id AS "userId"
    FROM monitored_items mi
    JOIN tender_items ti ON ti.tender_id = ${tenderId}
    WHERE mi.active = true
      AND (
        (ti.catmat_code IS NOT NULL AND ti.catmat_code = ANY(mi.catmat_codes))
        OR (ti.catser_code IS NOT NULL AND ti.catser_code = ANY(mi.catser_codes))
      )
  `

  const byItem = new Map<string, MatchCandidate>()

  for (const m of fuzzyMatches) {
    byItem.set(m.monitoredItemId, {
      monitoredItemId: m.monitoredItemId,
      userId: m.userId,
      score: m.score,
      matchedKeywords: m.matchedKeywords ?? [],
    })
  }

  // Match exato de código (CATMAT/CATSER) é o sinal mais forte — força score máximo
  for (const m of codeMatches) {
    const existing = byItem.get(m.monitoredItemId)
    if (existing) {
      existing.score = 1
    } else {
      byItem.set(m.monitoredItemId, {
        monitoredItemId: m.monitoredItemId,
        userId: m.userId,
        score: 1,
        matchedKeywords: [],
      })
    }
  }

  return Array.from(byItem.values())
}

export interface RematchInput {
  keywords: string[]
  catmatCodes: string[]
  catserCodes: string[]
  ufs: string[]
  modalidades: string[]
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

interface RematchFuzzyRow {
  tenderId: string
  score: number
  matchedKeywords: string[] | null
}

interface RematchCodeRow {
  tenderId: string
}

// Direção inversa do matching: dado um item monitorado (geralmente um recém-cadastrado),
// varre as licitações já coletadas nos últimos `sinceDays` dias em busca de coincidências —
// evita que o usuário precise esperar o próximo ciclo de coleta para ver resultados.
export async function findMatchingTendersForItem(
  item: RematchInput,
  sinceDays = 90
): Promise<RematchCandidate[]> {
  const { keywords, catmatCodes, catserCodes, ufs, modalidades, valorMin, valorMax, raioKm, origemLat, origemLng } = item

  const fuzzyRows =
    keywords.length > 0
      ? await prisma.$queryRaw<RematchFuzzyRow[]>`
          WITH kw AS (
            SELECT unnest(${keywords}::text[]) AS keyword
          ),
          candidates AS (
            SELECT t.id AS tender_id, t.objeto
            FROM tenders t
            WHERE t.created_at >= now() - make_interval(days => ${sinceDays}::int)
              AND (cardinality(${ufs}::text[]) = 0 OR t.uf = ANY(${ufs}::text[]))
              AND (${valorMin}::numeric IS NULL OR t.valor_estimado IS NULL OR ${valorMin}::numeric <= t.valor_estimado)
              AND (${valorMax}::numeric IS NULL OR t.valor_estimado IS NULL OR ${valorMax}::numeric >= t.valor_estimado)
              AND (cardinality(${modalidades}::text[]) = 0 OR t.modalidade::text = ANY(${modalidades}::text[]))
              AND (
                ${raioKm}::int IS NULL
                OR (
                  ${origemLat}::float IS NOT NULL AND t.municipio_lat IS NOT NULL
                  AND 6371 * acos(LEAST(1, GREATEST(-1,
                    cos(radians(${origemLat}::float)) * cos(radians(t.municipio_lat)) * cos(radians(t.municipio_lng) - radians(${origemLng}::float))
                    + sin(radians(${origemLat}::float)) * sin(radians(t.municipio_lat))
                  ))) <= ${raioKm}::int
                )
              )
          ),
          scored AS (
            SELECT c.tender_id AS "tenderId",
              MAX(GREATEST(
                word_similarity(kw.keyword, c.objeto),
                COALESCE((SELECT MAX(word_similarity(kw.keyword, ti.descricao)) FROM tender_items ti WHERE ti.tender_id = c.tender_id), 0)
              ))::float AS score,
              array_agg(DISTINCT kw.keyword) FILTER (WHERE word_similarity(kw.keyword, c.objeto) >= ${SIMILARITY_THRESHOLD}) AS "matchedKeywords"
            FROM candidates c
            CROSS JOIN kw
            GROUP BY c.tender_id
          )
          SELECT "tenderId", score, "matchedKeywords" FROM scored WHERE score >= ${SIMILARITY_THRESHOLD}
        `
      : []

  const codeRows =
    catmatCodes.length > 0 || catserCodes.length > 0
      ? await prisma.$queryRaw<RematchCodeRow[]>`
          SELECT DISTINCT ti.tender_id AS "tenderId"
          FROM tender_items ti
          JOIN tenders t ON t.id = ti.tender_id
          WHERE t.created_at >= now() - make_interval(days => ${sinceDays}::int)
            AND (
              (ti.catmat_code IS NOT NULL AND ti.catmat_code = ANY(${catmatCodes}::text[]))
              OR (ti.catser_code IS NOT NULL AND ti.catser_code = ANY(${catserCodes}::text[]))
            )
        `
      : []

  const byTender = new Map<string, RematchCandidate>()

  for (const r of fuzzyRows) {
    byTender.set(r.tenderId, {
      tenderId: r.tenderId,
      score: r.score,
      matchedKeywords: r.matchedKeywords ?? [],
    })
  }

  for (const r of codeRows) {
    const existing = byTender.get(r.tenderId)
    if (existing) {
      existing.score = 1
    } else {
      byTender.set(r.tenderId, { tenderId: r.tenderId, score: 1, matchedKeywords: [] })
    }
  }

  return Array.from(byTender.values())
}
