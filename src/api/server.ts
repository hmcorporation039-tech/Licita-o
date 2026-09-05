// ============================================================
// api/server.ts — API REST da plataforma de licitações
// Execute: npm run dev:api
// ============================================================

import 'dotenv/config'
import express, { ErrorRequestHandler } from 'express'
import cors from 'cors'
import { ZodError } from 'zod'
import { authRouter } from './routes/auth'
import { adminRouter } from './routes/admin'
import { monitoredItemsRouter } from './routes/monitoredItems'
import { tendersRouter } from './routes/tenders'
import { matchesRouter } from './routes/matches'
import { companyDocumentsRouter } from './routes/companyDocuments'
import { dashboardRouter } from './routes/dashboard'
import { participationPlansRouter } from './routes/participationPlans'
import { requireAuth } from './authMiddleware'
import { ApiError } from './asyncHandler'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Login/sessão — públicos por natureza. Criação de usuário é admin-only
// (ver /api/admin/users), não existe mais autocadastro aberto.
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)

// Todo o resto da plataforma exige sessão válida — a identidade do
// usuário vem do token (req.userId), não de um campo enviado pelo cliente.
app.use('/api/monitored-items', requireAuth, monitoredItemsRouter)
app.use('/api/tenders', requireAuth, tendersRouter)
app.use('/api/matches', requireAuth, matchesRouter)
app.use('/api/company-documents', requireAuth, companyDocumentsRouter)
app.use('/api/dashboard', requireAuth, dashboardRouter)
app.use('/api/participation-plans', requireAuth, participationPlansRouter)

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Dados inválidos', details: err.issues })
    return
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error('[API] Erro não tratado:', err)
  res.status(500).json({ error: 'Erro interno' })
}
app.use(errorHandler)

// Railway injeta PORT automaticamente pra serviços com domínio público —
// API_PORT continua valendo pra rodar local sem depender dessa variável.
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 3333)
app.listen(PORT, () => {
  console.log(`🌐 API rodando em http://localhost:${PORT}`)
})
