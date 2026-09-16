// ============================================================
// services/editalAnalysisService.ts — Baixa o conjunto documental de uma
// licitação e faz uma análise minuciosa por IA, cruzando com o
// checklist de habilitação (Lei 14.133/2021).
//
// Provedor de IA controlado por AI_PROVIDER no .env ('claude' | 'gemini',
// default 'claude'). Pensado pra trocar sem mexer em código: use 'gemini'
// (gratuito, via Google AI Studio) enquanto não tiver crédito na Claude,
// e volte pra 'claude' depois — ver src/services/llm/.
//
// AI_ANALYSIS_ENABLED é o interruptor geral: desligado (padrão), a função
// marca a análise como DISABLED antes de qualquer I/O — não baixa documento,
// não chama modelo, não gasta crédito.
// ============================================================

import axios from 'axios'
import { prisma } from './tenderService'
import {
  downloadPNCPDocument,
  isPdf,
  listPNCPDocuments,
  selecionarDocumentos,
} from './pncpDocumentsService'
import { AnalysisRefusedError, EditalAnalyzer, EditalDocumento } from './llm/types'
import { analyzeEdital as analyzeWithClaude } from './llm/claudeAnalyzer'
import { analyzeEdital as analyzeWithGemini } from './llm/geminiAnalyzer'

// Teto por requisição da API (32 MB). Ficamos abaixo com folga porque o
// base64 infla o binário em cerca de 1/3.
const MAX_BYTES_TOTAL = 20 * 1024 * 1024
const MAX_DOCUMENTOS = 5

export function analiseHabilitada(): boolean {
  return process.env.AI_ANALYSIS_ENABLED === 'true'
}

function getAnalyzer(): EditalAnalyzer {
  const provider = (process.env.AI_PROVIDER || 'claude').toLowerCase()
  if (provider === 'gemini') return analyzeWithGemini
  if (provider === 'claude') return analyzeWithClaude
  throw new Error(`AI_PROVIDER inválido: "${provider}" — use "claude" ou "gemini"`)
}

// Baixa até MAX_DOCUMENTOS PDFs, do mais relevante para o menos, parando
// quando o conjunto chega ao teto de tamanho.
async function baixarDocumentos(
  cnpj: string,
  ano: number,
  sequencial: number
): Promise<EditalDocumento[]> {
  const disponiveis = selecionarDocumentos(await listPNCPDocuments(cnpj, ano, sequencial))
  const selecionados: EditalDocumento[] = []
  let bytes = 0

  for (const doc of disponiveis) {
    if (selecionados.length >= MAX_DOCUMENTOS) break

    try {
      const buffer = await downloadPNCPDocument(doc.uri)
      if (!isPdf(buffer)) continue
      if (bytes + buffer.byteLength > MAX_BYTES_TOTAL) continue

      selecionados.push({ nome: doc.titulo, data: buffer })
      bytes += buffer.byteLength
    } catch (err) {
      console.error(`[Análise de edital] Falha ao baixar "${doc.titulo}":`, err instanceof Error ? err.message : err)
    }
  }

  return selecionados
}

export async function runEditalAnalysis(tenderId: string): Promise<void> {
  if (!analiseHabilitada()) {
    await prisma.tenderAnalysis.upsert({
      where: { tenderId },
      update: {
        status: 'DISABLED',
        errorMsg: 'A análise de edital por IA está desligada nesta instalação (AI_ANALYSIS_ENABLED).',
      },
      create: {
        tenderId,
        status: 'DISABLED',
        errorMsg: 'A análise de edital por IA está desligada nesta instalação (AI_ANALYSIS_ENABLED).',
      },
    })
    return
  }

  await prisma.tenderAnalysis.upsert({
    where: { tenderId },
    update: { status: 'RUNNING', errorMsg: null },
    create: { tenderId, status: 'RUNNING' },
  })

  try {
    const tender = await prisma.tender.findUnique({ where: { id: tenderId } })
    if (!tender) throw new Error('Licitação não encontrada')

    const raw = tender.rawJson as Record<string, unknown>
    const orgaoEntidade = raw.orgaoEntidade as Record<string, unknown> | undefined
    const cnpj = orgaoEntidade?.cnpj as string | undefined
    const ano = raw.anoCompra as number | undefined
    const sequencial = raw.sequencialCompra as number | undefined

    if (tender.fonte !== 'PNCP' || !cnpj || !ano || !sequencial) {
      await prisma.tenderAnalysis.update({
        where: { tenderId },
        data: {
          status: 'NO_DOCUMENTS',
          errorMsg: 'Documentos só estão disponíveis para licitações publicadas no PNCP.',
        },
      })
      return
    }

    const documentos = await baixarDocumentos(cnpj, ano, sequencial)

    if (documentos.length === 0) {
      await prisma.tenderAnalysis.update({
        where: { tenderId },
        data: { status: 'NO_DOCUMENTS', errorMsg: 'Nenhum documento em PDF foi encontrado no PNCP para esta licitação.' },
      })
      return
    }

    const documentoNome = documentos.map((d) => d.nome).join(' · ')

    let resultado
    try {
      resultado = await getAnalyzer()(tender.objeto, documentos)
    } catch (err) {
      if (err instanceof AnalysisRefusedError) {
        await prisma.tenderAnalysis.update({
          where: { tenderId },
          data: { status: 'FAILED', documentoNome, errorMsg: err.message },
        })
        return
      }
      throw err
    }

    await prisma.tenderAnalysis.update({
      where: { tenderId },
      data: {
        status: 'DONE',
        documentoNome,
        resultado: resultado as unknown as object,
        errorMsg: null,
      },
    })
  } catch (err) {
    // A API não-oficial de documentos do PNCP (pncpDocumentsService) cai com
    // frequência (fora do nosso controle) — em vez do axios "Request failed
    // with status code 503" cru, mostra algo que a pessoa usuária entenda.
    const isPncpDown = axios.isAxiosError(err) && (!err.response || err.response.status >= 500)
    const errorMsg = isPncpDown
      ? 'PNCP está indisponível no momento (não foi possível baixar os documentos do edital). Tente novamente mais tarde.'
      : err instanceof Error
        ? err.message
        : String(err)
    await prisma.tenderAnalysis.update({
      where: { tenderId },
      data: { status: 'FAILED', errorMsg },
    })
    throw err
  }
}
