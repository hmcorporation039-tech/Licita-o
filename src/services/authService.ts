// ============================================================
// services/authService.ts — Hash de senha + assinatura/verificação de
// token de sessão. bcryptjs (puro JS, sem compilação nativa — evita
// dor de cabeça de build no Windows) + jsonwebtoken.
// ============================================================

import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const SALT_ROUNDS = 10
// Validade do token de SESSÃO (login) — diferente da validade da CONTA
// (User.accessExpiresAt), que é quem controla se a conta ainda pode logar.
const SESSION_DURATION = '30d'

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET não configurado no .env')
  return secret
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export interface SessionTokenPayload {
  userId: string
}

export function signSessionToken(userId: string): string {
  return jwt.sign({ userId } satisfies SessionTokenPayload, getJwtSecret(), { expiresIn: SESSION_DURATION })
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret())
    if (typeof decoded === 'object' && decoded && typeof decoded.userId === 'string') {
      return { userId: decoded.userId }
    }
    return null
  } catch {
    return null
  }
}

// Gera uma senha temporária legível (usada ao criar usuário pelo admin,
// quando ele não define uma senha específica).
export function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}
