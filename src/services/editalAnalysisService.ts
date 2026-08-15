// ============================================================
// services/editalAnalysisService.ts — Baixa o edital de uma
// licitação e faz uma análise minuciosa com a API da Claude,
// cruzando com o checklist de habilitação (Lei 14.133/2021).
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './tenderService'
import { listPNCPDocuments, downloadPNCPDocument, pickMainDocument } from './pncpDocumentsService'
import { extractPdfText } from './pdfTextService'

// Limite defensivo de caracteres enviados ao modelo — editais muito longos
// (centenas de páginas) ainda cabem no contexto de 1M tokens, mas isso
// evita gasto desnecessário em anexos de baixo valor informativo.
const MAX_TEXT_CHARS = 200_000

let anthropicClient: Anthropic | null = null
function getClient(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic()
  return anthropicClient
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    resumo: { type: 'string' },
    valorEstimado: { type: 'string' },
    prazoEntrega: { type: 'string' },
    criterioJulgamento: { type: 'string' },
    exigenciasTecnicas: { type: 'array', items: { type: 'string' } },
    documentosExigidos: { type: 'array', items: { type: 'string' } },
    riscos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          descricao: { type: 'string' },
          severidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        },
        required: ['titulo', 'descricao', 'severidade'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'resumo',
    'valorEstimado',
    'prazoEntrega',
    'criterioJulgamento',
    'exigenciasTecnicas',
    'documentosExigidos',
    'riscos',
  ],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `Você é um analista especialista em licitações públicas brasileiras (Lei nº 14.133/2021).
Leia o edital fornecido e produza uma análise minuciosa e objetiva para uma empresa que está avaliando participar.

Extraia:
- resumo: 2-3 frases sobre o objeto da licitação
- valorEstimado, prazoEntrega, criterioJulgamento: extraia do texto; escreva "não especificado no edital" se não encontrar
- exigenciasTecnicas: lista de exigências de qualificação técnica (atestados, registros em conselho de classe, etc.)
- documentosExigidos: documentos de habilitação exigidos NESTE edital além do básico padrão (contrato social, certidões federais/estaduais/municipais, CNDT, FGTS) — ou seja, o que é ESPECÍFICO deste edital: garantias, declarações incomuns, vistoria obrigatória, qualificação econômico-financeira com índices específicos, etc.
- riscos: pontos de atenção reais encontrados no texto, no estilo de auditoria de concorrência — exemplos do que procurar: exigência de atestado técnico com critérios muito restritivos, planilha de custos com prazo de preenchimento apertado, exigência de visita técnica obrigatória com prazo curto, cláusulas de habilitação que podem restringir a competitividade indevidamente, valores ou prazos incomuns, exigências de qualificação econômico-financeira desproporcionais ao objeto. Marque severidade "alta" só para riscos que podem de fato inabilitar ou prejudicar uma proposta.

Seja específico e cite trechos do edital quando relevante. Não invente informação que não está no texto.`

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

    const message = await getClient().messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `Objeto da licitação (conforme cadastro no PNCP): ${tender.objeto}\n\n--- TEXTO DO EDITAL ---\n\n${text}`,
        },
      ],
    })

    if (message.stop_reason === 'refusal') {
      await prisma.tenderAnalysis.update({
        where: { tenderId },
        data: { status: 'FAILED', documentoNome: main.titulo, errorMsg: 'A análise foi recusada pelos filtros de segurança do modelo.' },
      })
      return
    }

    const textBlock = message.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Resposta do modelo não contém o resultado esperado')
    }
    const parsed = JSON.parse(textBlock.text)

    await prisma.tenderAnalysis.update({
      where: { tenderId },
      data: {
        status: 'DONE',
        documentoNome: main.titulo,
        resultado: parsed as object,
        errorMsg: null,
      },
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await prisma.tenderAnalysis.update({
      where: { tenderId },
      data: { status: 'FAILED', errorMsg },
    })
    throw err
  }
}
