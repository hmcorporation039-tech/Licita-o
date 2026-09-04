// ============================================================
// api/routes/auth.ts — Login e troca de senha
// (criação de usuário é feita pelo admin — ver routes/admin.ts)
// ============================================================

import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../../services/tenderService'
import { hashPassword, signSessionToken, verifyPassword } from '../../services/authService'
import { asyncHandler, ApiError } from '../asyncHandler'
import { requireAuth } from '../authMiddleware'

export const authRouter = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email } })
    // Mesma mensagem de erro pra e-mail inexistente e senha errada — não
    // dá pra um atacante descobrir quais e-mails têm conta só tentando.
    const invalid = () => new ApiError(401, 'E-mail ou senha inválidos')

    if (!user || !user.active) throw invalid()
    if (!user.passwordHash) {
      throw new ApiError(403, 'Esta conta ainda não tem senha definida — fale com o administrador')
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw invalid()
    if (user.accessExpiresAt && user.accessExpiresAt.getTime() < Date.now()) {
      throw new ApiError(403, 'O acesso desta conta expirou — fale com o administrador')
    }

    const token = signSessionToken(user.id)
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
    })
  })
)

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'A nova senha precisa ter pelo menos 8 caracteres'),
})

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } })
    if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError(401, 'Senha atual incorreta')
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    })
    res.status(204).send()
  })
)

// Retorna os dados do usuário autenticado (pra revalidar a sessão salva no
// navegador ao carregar a página, sem precisar logar de novo).
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } })
    res.json({ id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin })
  })
)
