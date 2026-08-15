// ============================================================
// scripts/cleanupOldTenders.ts — Dispara manualmente a limpeza de
// licitações antigas sem match (o worker já faz isso periodicamente
// sozinho — ver retentionService.ts / workers/index.ts).
// ============================================================

import { cleanupOldUnmatchedTenders, RETENTION_DAYS } from '../src/services/retentionService'
import { prisma } from '../src/services/tenderService'

async function main() {
  const { deleted } = await cleanupOldUnmatchedTenders()
  console.log(`${deleted} licitação(ões) sem match, com mais de ${RETENTION_DAYS} dias, removida(s).`)
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
