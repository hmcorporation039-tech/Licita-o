// ============================================================
// api/routes/companyDocuments.ts — Cofre de documentos da empresa
// Documentos cadastrados uma vez (não por licitação), cruzados
// automaticamente com o checklist de cada licitação pelo campo `tipo`.
// ============================================================

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../services/tenderService'
import { asyncHandler, ApiError } from '../asyncHandler'

export const companyDocumentsRouter = Router()

const createSchema = z.object({
  userId: z.string().uuid(),
  tipo: z.string().min(1).nullable().optional(),
  nome: z.string().min(1),
  dataEmissao: z.coerce.date().nullable().optional(),
  dataValidade: z.coerce.date().nullable().optional(),
  observacao: z.string().nullable().optional(),
})

const updateSchema = createSchema.partial().omit({ userId: true })

async function assertOwnership(docId: string, userId: string | undefined) {
  const doc = await prisma.companyDocument.findUnique({ where: { id: docId } })
  if (!doc) throw new ApiError(404, 'Documento não encontrado')
  if (userId && doc.userId !== userId) throw new ApiError(403, 'Este documento não pertence ao usuário informado')
  return doc
}

companyDocumentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body)
    const doc = await prisma.companyDocument.create({ data: body })
    res.status(201).json(doc)
  })
)

companyDocumentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.query.userId
    if (typeof userId !== 'string') throw new ApiError(400, 'Parâmetro userId é obrigatório')

    const docs = await prisma.companyDocument.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(docs)
  })
)

companyDocumentsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId : undefined
    await assertOwnership(req.params.id, bodyUserId)

    const data = updateSchema.parse(req.body)
    const updated = await prisma.companyDocument.update({ where: { id: req.params.id }, data })
    res.json(updated)
  })
)

companyDocumentsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId : undefined
    await assertOwnership(req.params.id, bodyUserId)

    await prisma.companyDocument.delete({ where: { id: req.params.id } })
    res.status(204).send()
  })
)
