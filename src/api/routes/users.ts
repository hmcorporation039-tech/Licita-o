// ============================================================
// api/routes/users.ts — Cadastro mínimo de usuário (sem auth ainda)
// ============================================================

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../services/tenderService'
import { asyncHandler, ApiError } from '../asyncHandler'

export const usersRouter = Router()

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
})

// Cria o usuário se não existir, ou retorna o existente com o mesmo e-mail
// (não há autenticação nesta fase — qualquer chamador pode se identificar por e-mail)
usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body)

    const user = await prisma.user.upsert({
      where: { email: body.email },
      update: body.name ? { name: body.name } : {},
      create: { email: body.email, name: body.name },
    })

    res.status(201).json(user)
  })
)

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!user) throw new ApiError(404, 'Usuário não encontrado')
    res.json(user)
  })
)
