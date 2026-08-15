// ============================================================
// services/tenderService.ts — Persiste licitações no banco
// ============================================================

import { Prisma, PrismaClient } from '@prisma/client'
import { NormalizedTender, NormalizedTenderItem } from '../types'

const prisma = new PrismaClient()

export interface SaveResult {
  isNew: boolean
  tenderId: string
  isDupe: boolean
}

// Salva (ou ignora se duplicata) uma licitação normalizada
export async function saveTender(tender: NormalizedTender): Promise<SaveResult> {
  // Verifica se já existe pela chave única fonteId
  const existing = await prisma.tender.findUnique({
    where: { fonteId: tender.fonteId },
    select: { id: true },
  })

  if (existing) {
    return { isNew: false, tenderId: existing.id, isDupe: true }
  }

  // Cria a licitação e seus itens em uma transação
  const created = await prisma.$transaction(async (tx) => {
    const newTender = await tx.tender.create({
      data: {
        fonte: tender.fonte,
        fonteId: tender.fonteId,
        modalidade: tender.modalidade,
        objeto: tender.objeto,
        objetoResumido: tender.objetoResumido,
        valorEstimado: tender.valorEstimado,
        uf: tender.uf,
        municipio: tender.municipio,
        municipioIbge: tender.municipioIbge,
        municipioLat: tender.municipioLat,
        municipioLng: tender.municipioLng,
        orgao: tender.orgao,
        orgaoCnpj: tender.orgaoCnpj,
        unidade: tender.unidade,
        aberturaAt: tender.aberturaAt,
        encerramentoAt: tender.encerramentoAt,
        publicadoAt: tender.publicadoAt,
        linkEdital: tender.linkEdital,
        numeroControle: tender.numeroControle,
        rawJson: tender.rawJson as Prisma.InputJsonValue,
      },
    })

    // Salva itens se existirem
    if (tender.items && tender.items.length > 0) {
      await tx.tenderItem.createMany({
        data: tender.items.map((item) => ({
          tenderId: newTender.id,
          numeroItem: item.numeroItem,
          descricao: item.descricao,
          catmatCode: item.catmatCode,
          catserCode: item.catserCode,
          unidadeMedida: item.unidadeMedida,
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          valorTotal: item.valorTotal,
        })),
      })
    }

    return newTender
  })

  return { isNew: true, tenderId: created.id, isDupe: false }
}

// Salva os itens de uma licitação já existente (busca sob demanda, feita
// quando o usuário abre o detalhe pela primeira vez) — não duplica se já
// tiver itens salvos.
export async function saveTenderItemsIfMissing(
  tenderId: string,
  items: NormalizedTenderItem[]
): Promise<void> {
  const existingCount = await prisma.tenderItem.count({ where: { tenderId } })
  if (existingCount > 0 || items.length === 0) return

  await prisma.tenderItem.createMany({
    data: items.map((item) => ({
      tenderId,
      numeroItem: item.numeroItem,
      descricao: item.descricao,
      catmatCode: item.catmatCode,
      catserCode: item.catserCode,
      unidadeMedida: item.unidadeMedida,
      quantidade: item.quantidade,
      valorUnitario: item.valorUnitario,
      valorTotal: item.valorTotal,
    })),
  })
}

// Registra log de execução do worker
export async function saveWorkerLog(data: {
  worker: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL'
  fonte?: 'PNCP' | 'COMPRASNET'
  totalFetched?: number
  totalNew?: number
  totalDupes?: number
  errorMsg?: string
  startedAt: Date
  finishedAt?: Date
}) {
  return prisma.workerLog.create({ data })
}

export { prisma }
