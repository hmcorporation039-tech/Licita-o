// ============================================================
// api/rateLimit.ts — Limites de requisição por IP.
// O /api/auth/login não tinha limite nenhum: força bruta de senha
// era livre e barata.
// ============================================================

import rateLimit from 'express-rate-limit'

const JANELA_MS = 15 * 60 * 1000

export const globalLimiter = rateLimit({
  windowMs: JANELA_MS,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas requisições — aguarde alguns minutos e tente de novo' },
})

export const loginLimiter = rateLimit({
  windowMs: JANELA_MS,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Login que deu certo não conta para o limite — quem sabe a senha não é
  // penalizado por alguém tentando adivinhá-la do mesmo IP.
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas de login — aguarde alguns minutos e tente de novo' },
})

export const escritaSensivelLimiter = rateLimit({
  windowMs: JANELA_MS,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas requisições — aguarde alguns minutos e tente de novo' },
})
