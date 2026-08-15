// ============================================================
// workers/index.ts — Entrypoint dos workers
// Execute: npx ts-node src/workers/index.ts
// ============================================================

import 'dotenv/config'
import { scheduleColetorJobs } from '../queues'
import { startColetorPNCPWorker } from './coletorPNCP'
import { startColetorComprasnetWorker } from './coletorComprasnet'
import { startMatcherWorker } from './matcher'
import { startNotificadorWorker } from './notificador'

async function main() {
  console.log('🚀 Iniciando workers da plataforma de licitações...')

  // Sobe os workers em paralelo
  const workerPNCP = startColetorPNCPWorker()
  const workerComprasnet = startColetorComprasnetWorker()
  const workerMatcher = startMatcherWorker()
  const workerNotificador = startNotificadorWorker()

  console.log('✅ Workers ativos: PNCP, ComprasNet, Matcher, Notificador')

  // Agenda coletas periódicas
  await scheduleColetorJobs()

  // Dispara uma coleta imediata ao iniciar (backfill dos últimos 2 dias)
  const { coletorPNCPQueue, coletorComprasnetQueue } = await import('../queues')
  const today = new Date()
  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  await coletorPNCPQueue.add('coleta-pncp-inicial', {
    fonte: 'PNCP',
    dataInicial: fmt(twoDaysAgo),
    dataFinal: fmt(today),
  })

  await coletorComprasnetQueue.add('coleta-comprasnet-inicial', {
    fonte: 'COMPRASNET',
    dataInicial: fmt(twoDaysAgo),
    dataFinal: fmt(today),
  })

  console.log('📥 Coleta inicial disparada (últimos 2 dias).')

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Encerrando workers...')
    await workerPNCP.close()
    await workerComprasnet.close()
    await workerMatcher.close()
    await workerNotificador.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Erro fatal ao iniciar workers:', err)
  process.exit(1)
})
