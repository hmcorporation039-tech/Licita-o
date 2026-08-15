// ============================================================
// lib/session.ts — Sessão simples via localStorage (sem auth real ainda)
// ============================================================

const KEY = 'licitacao-platform:user'

export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionUser
  } catch {
    return null
  }
}

export function setSessionUser(user: SessionUser) {
  window.localStorage.setItem(KEY, JSON.stringify(user))
}

export function clearSessionUser() {
  window.localStorage.removeItem(KEY)
}
