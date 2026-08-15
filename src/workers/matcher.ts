// ============================================================
// workers/matcher.ts — Agente Matcher
// Consome a fila 'matcher': cruza a licitação recém-salva com
// os itens monitorados ativos e grava os matches novos.
// ============================================================

import { Worker, Job } from 'bullmq'
import { redisConnection, notificadorQueue } from '../queues'
import { prisma } from '../services/tenderService'
import { findMatchCandidates } from '../services/matcherService'
import { MatcherJobPayload } from '../types'

export function startMatcherWorker() {
  const worker = new Worker<MatcherJobPayload>(
    'matcher',
    async (job: Job<MatcherJobPayload>) => {
      const { tenderId } = job.data
      const candidates = await findMatchCandidates(tenderId)
      if (candidates.length === 0) return

      const monitoredItemIds = candidates.map((c) => c.monitoredItemId)
      const existing = await prisma.tenderMatch.findMany({
        where: { tenderId, monitoredItemId: { in: monitoredItemIds } },
        select: { monitoredItemId: true },
      })
      const existingSet = new Set(existing.map((e) => e.monitoredItemId))
      const newCandidates = candidates.filter((c) => !existingSet.has(c.monitoredItemId))
      if (newCandidates.length === 0) return

      await prisma.tenderMatch.createMany({
        data: newCandidates.map((c) => ({
          tenderId,
          monitoredItemId: c.monitoredItemId,
          userId: c.userId,
          score: c.score,
          matchedKeywords: c.matchedKeywords,
        })),
        skipDuplicates: true,
      })

      const created = await prisma.tenderMatch.findMany({
        where: { tenderId, monitoredItemId: { in: newCandidates.map((c) => c.monitoredItemId) } },
        select: { id: true },
      })

      for (const match of created) {
        await notificadorQueue.add('notify-match', { tenderMatchId: match.id })
      }

      console.log(`[Matcher Worker] Tender ${tenderId} → ${created.length} novo(s) match(es).`)
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  )

  worker.on('failed', (job, err) => {
    console.error(`[Matcher Worker] Job ${job?.id} falhou:`, err.message)
  })

  return worker
}
