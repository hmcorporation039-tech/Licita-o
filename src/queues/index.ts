// ============================================================
// queues/index.ts — Configuração BullMQ + Redis
// ============================================================

import { Queue, QueueOptions } from 'bullmq'
import IORedis from 'ioredis'

// Conexão Redis compartilhada
export const redisConnection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Obrigatório para BullMQ
})

const defaultQueueOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000, // 5s → 10s → 20s
    },
    removeOnComplete: { count: 100 }, // Mantém últimos 100 jobs concluídos
    removeOnFail: { count: 200 },     // Mantém últimos 200 com falha para debug
  },
}

// Filas de coleta — uma por fonte, para que cada worker consuma só a sua
// (numa fila única compartilhada, o BullMQ distribui os jobs entre workers
// concorrentes sem olhar o payload, então o job do PNCP podia ser pego pelo
// worker do ComprasNet e vice-versa, retornando sem coletar nada)
export const coletorPNCPQueue = new Queue('coletor-pncp', defaultQueueOptions)
export const coletorComprasnetQueue = new Queue('coletor-comprasnet', defaultQueueOptions)

// Fila de matching (disparada após salvar cada licitação nova)
export const matcherQueue = new Queue('matcher', defaultQueueOptions)

// Fila de notificações
export const notificadorQueue = new Queue('notificador', defaultQueueOptions)

// Agenda os jobs de coleta periódica
export async function scheduleColetorJobs() {
  // Remove agendamentos antigos para evitar duplicatas
  await coletorPNCPQueue.drain()
  await coletorComprasnetQueue.drain()

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const today = new Date()

  const fmt = (d: Date) => d.toISOString().split('T')[0]

  // Job PNCP — roda a cada 2h
  await coletorPNCPQueue.add(
    'coleta-pncp',
    {
      fonte: 'PNCP',
      dataInicial: fmt(yesterday),
      dataFinal: fmt(today),
    },
    {
      repeat: { pattern: '0 */2 * * *' },
    }
  )

  // Job ComprasNet — roda a cada 2h com offset de 1h
  await coletorComprasnetQueue.add(
    'coleta-comprasnet',
    {
      fonte: 'COMPRASNET',
      dataInicial: fmt(yesterday),
      dataFinal: fmt(today),
    },
    {
      repeat: { pattern: '0 1-23/2 * * *' },
    }
  )

  console.log('[Queue] Jobs de coleta agendados.')
}
