// ============================================================
// workers/notificador.ts — Agente Notificador
// Consome a fila 'notificador': envia e-mail para o dono do
// item monitorado quando há um match novo.
// ============================================================

import { Worker, Job } from 'bullmq'
import { redisConnection } from '../queues'
import { prisma } from '../services/tenderService'
import { sendMatchEmail } from '../services/emailService'
import { NotificadorJobPayload } from '../types'

export function startNotificadorWorker() {
  const worker = new Worker<NotificadorJobPayload>(
    'notificador',
    async (job: Job<NotificadorJobPayload>) => {
      const { tenderMatchId } = job.data

      // Idempotência: não reenvia se já existe notificação para este match
      const alreadySent = await prisma.notification.findFirst({
        where: { metadata: { path: ['tenderMatchId'], equals: tenderMatchId } },
        select: { id: true },
      })
      if (alreadySent) return

      const match = await prisma.tenderMatch.findUnique({
        where: { id: tenderMatchId },
        include: { tender: true, monitoredItem: true, user: true },
      })
      if (!match) return

      await sendMatchEmail({
        to: match.user.email,
        itemName: match.monitoredItem.name,
        tenderObjeto: match.tender.objetoResumido ?? match.tender.objeto,
        orgao: match.tender.orgao,
        uf: match.tender.uf,
        valorEstimado: match.tender.valorEstimado ? Number(match.tender.valorEstimado) : null,
        linkEdital: match.tender.linkEdital,
      })

      await prisma.notification.create({
        data: {
          userId: match.userId,
          type: 'EMAIL',
          title: `Nova licitação: ${match.monitoredItem.name}`,
          body: match.tender.objetoResumido ?? match.tender.objeto,
          sentAt: new Date(),
          metadata: { tenderMatchId },
        },
      })

      console.log(`[Notificador Worker] E-mail enviado para ${match.user.email} (match ${tenderMatchId})`)
    },
    {
      connection: redisConnection,
      concurrency: 3,
    }
  )

  worker.on('failed', (job, err) => {
    console.error(`[Notificador Worker] Job ${job?.id} falhou:`, err.message)
  })

  return worker
}
