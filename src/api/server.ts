// ============================================================
// api/server.ts — API REST da plataforma de licitações
// Execute: npm run dev:api
// ============================================================

import 'dotenv/config'
import express, { ErrorRequestHandler } from 'express'
import cors from 'cors'
import { ZodError } from 'zod'
import { usersRouter } from './routes/users'
import { monitoredItemsRouter } from './routes/monitoredItems'
import { tendersRouter } from './routes/tenders'
import { matchesRouter } from './routes/matches'
import { companyDocumentsRouter } from './routes/companyDocuments'
import { ApiError } from './asyncHandler'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use('/api/users', usersRouter)
app.use('/api/monitored-items', monitoredItemsRouter)
app.use('/api/tenders', tendersRouter)
app.use('/api/matches', matchesRouter)
app.use('/api/company-documents', companyDocumentsRouter)

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

const PORT = process.env.API_PORT ? Number(process.env.API_PORT) : 3333
app.listen(PORT, () => {
  console.log(`🌐 API rodando em http://localhost:${PORT}`)
})
