// ============================================================
// services/editalAnalysisService.ts — Baixa o edital de uma
// licitação e faz uma análise minuciosa por IA, cruzando com o
// checklist de habilitação (Lei 14.133/2021).
//
// Provedor de IA controlado por AI_PROVIDER no .env ('claude' | 'gemini',
// default 'claude'). Pensado pra trocar sem mexer em código: use 'gemini'
// (gratuito, via Google AI Studio) enquanto não tiver crédito na Claude,
// e volte pra 'claude' depois — ver src/services/llm/.
// ============================================================

import axios from 'axios'
import { prisma } from './tenderService'
import { listPNCPDocuments, downloadPNCPDocument, pickMainDocument } from './pncpDocumentsService'
import { extractPdfText } from './pdfTextService'
import { AnalysisRefusedError, EditalAnalysisResult } from './llm/types'
import { analyzeEdital as analyzeWithClaude } from './llm/claudeAnalyzer'
import { analyzeEdital as analyzeWithGemini } from './llm/geminiAnalyzer'

// Limite defensivo de caracteres enviados ao modelo — editais muito longos
// (centenas de páginas) ainda cabem no contexto de 1M tokens, mas isso
// evita gasto desnecessário em anexos de baixo valor informativo.
const MAX_TEXT_CHARS = 200_000

function getAnalyzer(): (objeto: string, text: string) => Promise<EditalAnalysisResult> {
  const provider = (process.env.AI_PROVIDER || 'claude').toLowerCase()
  if (provider === 'gemini') return analyzeWithGemini
  if (provider === 'claude') return analyzeWithClaude
  throw new Error(`AI_PROVIDER inválido: "${provider}" — use "claude" ou "gemini"`)
}

export async function runEditalAnalysis(tenderId: string): Promise<void> {
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

    const docs = await listPNCPDocuments(cnpj, ano, sequencial)
    const main = pickMainDocument(docs)

    if (!main) {
      await prisma.tenderAnalysis.update({
        where: { tenderId },
        data: { status: 'NO_DOCUMENTS', errorMsg: 'Nenhum documento publicado foi encontrado no PNCP.' },
      })
      return
    }

    const pdfBuffer = await downloadPNCPDocument(main.uri)
    const fullText = await extractPdfText(pdfBuffer)
    const text = fullText.slice(0, MAX_TEXT_CHARS)

    if (!text.trim()) {
      await prisma.tenderAnalysis.update({
        where: { tenderId },
        data: {
          status: 'FAILED',
          documentoNome: main.titulo,
          errorMsg: 'Não foi possível extrair texto do documento (pode ser um PDF escaneado/imagem).',
        },
      })
      return
    }

    let resultado: EditalAnalysisResult
    try {
      resultado = await getAnalyzer()(tender.objeto, text)
    } catch (err) {
      if (err instanceof AnalysisRefusedError) {
        await prisma.tenderAnalysis.update({
          where: { tenderId },
          data: { status: 'FAILED', documentoNome: main.titulo, errorMsg: err.message },
        })
        return
      }
      throw err
    }

    await prisma.tenderAnalysis.update({
      where: { tenderId },
      data: {
        status: 'DONE',
        documentoNome: main.titulo,
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
