// ============================================================
// services/retentionService.ts — Limpa licitações antigas que nunca
// deram match com nenhum item monitorado, pra não deixar o banco
// crescer indefinidamente com dados irrelevantes.
//
// Regra: só apaga tenders com mais de RETENTION_DAYS dias E que não
// têm nenhum TenderMatch, TenderChecklist ou TenderAnalysis associado
// (ou seja, ninguém nunca interagiu com elas). RETENTION_DAYS é o
// mesmo período usado pelo rematch (findMatchingTendersForItem) — uma
// licitação sem match mais velha que isso já não seria encontrada por
// "Buscar agora" de qualquer forma, então apagar não perde capacidade
// nenhuma hoje.
// ============================================================

import { prisma } from './tenderService'

export const RETENTION_DAYS = 90

export async function cleanupOldUnmatchedTenders(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const result = await prisma.tender.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      tenderMatches: { none: {} },
      checklists: { none: {} },
      analysis: null,
    },
  })

  return { deleted: result.count }
}
