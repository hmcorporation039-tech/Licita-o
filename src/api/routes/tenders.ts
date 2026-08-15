// ============================================================
// api/routes/tenders.ts — Feed público de licitações coletadas
// ============================================================

import { Router } from 'express'
import { z } from 'zod'
import { prisma, saveTenderItemsIfMissing } from '../../services/tenderService'
import { asyncHandler, ApiError } from '../asyncHandler'
import { buildChecklistTemplate, ChecklistItem } from '../../lib/checklistTemplate'
import { runEditalAnalysis } from '../../services/editalAnalysisService'
import { fetchPNCPItens } from '../../services/pncpItemsService'

export const tendersRouter = Router()

const querySchema = z.object({
  uf: z.string().length(2).optional(),
  modalidade: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

tendersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { uf, modalidade, page, pageSize } = querySchema.parse(req.query)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {}
    if (uf) where.uf = uf
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (modalidade) where.modalidade = modalidade as any

    const [items, total] = await Promise.all([
      prisma.tender.findMany({
        where,
        orderBy: { publicadoAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.tender.count({ where }),
    ])

    res.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
  })
)

tendersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    let tender = await prisma.tender.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    })
    if (!tender) {
      res.status(404).json({ error: 'Licitação não encontrada' })
      return
    }

    // Busca sob demanda: a coleta periódica não traz os itens (chamada separada
    // no PNCP) — busca na primeira vez que alguém abre o detalhe e guarda.
    if (tender.items.length === 0 && tender.fonte === 'PNCP') {
      const raw = tender.rawJson as Record<string, unknown>
      const orgaoEntidade = raw.orgaoEntidade as Record<string, unknown> | undefined
      const cnpj = orgaoEntidade?.cnpj as string | undefined
      const ano = raw.anoCompra as number | undefined
      const sequencial = raw.sequencialCompra as number | undefined

      if (cnpj && ano && sequencial) {
        try {
          const itens = await fetchPNCPItens(cnpj, ano, sequencial)
          await saveTenderItemsIfMissing(tender.id, itens)
          tender = await prisma.tender.findUnique({ where: { id: req.params.id }, include: { items: true } })
        } catch (err) {
          console.error('[Tenders] Erro ao buscar itens do PNCP:', err)
        }
      }
    }

    res.json(tender)
  })
)

const checklistItemSchema = z.object({
  id: z.string().min(1),
  section: z.string().min(1),
  label: z.string().min(1),
  hint: z.string().optional(),
  checked: z.boolean(),
  custom: z.boolean(),
})

const putChecklistSchema = z.object({
  userId: z.string().uuid(),
  items: z.array(checklistItemSchema).min(1),
})

// Retorna o checklist do usuário para esta licitação, criando a partir do
// template padrão (guia de habilitação Lei 14.133/2021) na primeira vez.
tendersRouter.get(
  '/:id/checklist',
  asyncHandler(async (req, res) => {
    const userId = req.query.userId
    if (typeof userId !== 'string') throw new ApiError(400, 'Parâmetro userId é obrigatório')

    const tender = await prisma.tender.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!tender) throw new ApiError(404, 'Licitação não encontrada')

    const existing = await prisma.tenderChecklist.findUnique({
      where: { userId_tenderId: { userId, tenderId: req.params.id } },
    })
    if (existing) {
      res.json(existing)
      return
    }

    const created = await prisma.tenderChecklist.create({
      data: {
        userId,
        tenderId: req.params.id,
        items: buildChecklistTemplate() as unknown as object,
      },
    })
    res.json(created)
  })
)

// Salva o estado do checklist (itens marcados + itens customizados adicionados
// pelo usuário) — o frontend envia o array completo a cada alteração.
tendersRouter.put(
  '/:id/checklist',
  asyncHandler(async (req, res) => {
    const { userId, items } = putChecklistSchema.parse(req.body)

    const tender = await prisma.tender.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!tender) throw new ApiError(404, 'Licitação não encontrada')

    const saved = await prisma.tenderChecklist.upsert({
      where: { userId_tenderId: { userId, tenderId: req.params.id } },
      update: { items: items as ChecklistItem[] as unknown as object },
      create: { userId, tenderId: req.params.id, items: items as ChecklistItem[] as unknown as object },
    })
    res.json(saved)
  })
)

// Retorna a análise do edital feita por IA, se já existir.
tendersRouter.get(
  '/:id/analysis',
  asyncHandler(async (req, res) => {
    const analysis = await prisma.tenderAnalysis.findUnique({ where: { tenderId: req.params.id } })
    if (!analysis) {
      res.status(404).json({ error: 'Análise ainda não foi solicitada para esta licitação' })
      return
    }
    res.json(analysis)
  })
)

// Dispara (ou retorna a já existente) a análise do edital via IA.
// Baixa o documento do PNCP, extrai o texto e analisa com a Claude —
// leva alguns segundos, por isso é síncrono na resposta.
tendersRouter.post(
  '/:id/analyze',
  asyncHandler(async (req, res) => {
    const tender = await prisma.tender.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!tender) throw new ApiError(404, 'Licitação não encontrada')

    const force = req.query.force === 'true'

    if (!force) {
      const existing = await prisma.tenderAnalysis.findUnique({ where: { tenderId: req.params.id } })
      if (existing && existing.status === 'DONE') {
        res.json(existing)
        return
      }
    }

    // Erros já ficam registrados no próprio registro (status FAILED + errorMsg);
    // não propaga como 500 para o cliente conseguir mostrar o motivo.
    try {
      await runEditalAnalysis(req.params.id)
    } catch (err) {
      console.error('[Análise de edital] Erro:', err)
    }

    const result = await prisma.tenderAnalysis.findUnique({ where: { tenderId: req.params.id } })
    res.json(result)
  })
)
