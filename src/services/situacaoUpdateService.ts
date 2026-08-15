// ============================================================
// services/situacaoUpdateService.ts — Atualiza a situação real de
// licitações do PNCP (a coleta só grava o status no momento da
// publicação, e o campo nunca era atualizado depois disso — todo
// registro ficava com o valor padrão ABERTA para sempre).
//
// Mapeamento de situacaoCompraId → SituacaoEnum determinado empiricamente
// (não documentado na API pública do PNCP) a partir dos valores observados
// nas licitações já coletadas. Se o PNCP retornar um id não mapeado aqui,
// a situação é mantida como estava e um aviso é registrado — mais seguro
// que adivinhar.
//
// Heurística adicional: o PNCP mantém situacaoCompraId=1 ("Divulgada no
// PNCP") mesmo depois que o prazo de recebimento de propostas já passou
// (não achamos um código de status separado pra "encerrada" na prática) —
// então tratamos isso localmente como ENCERRADA quando encerramentoAt já
// passou, pra essa informação não ficar sempre "Aberta" indefinidamente.
// ============================================================

import { SituacaoEnum } from '@prisma/client'
import { pncpClient } from '../lib/httpClient'
import { prisma } from './tenderService'

const SITUACAO_COMPRA_ID_MAP: Record<number, SituacaoEnum> = {
  1: 'ABERTA',
  2: 'REVOGADA',
  3: 'ANULADA',
  4: 'SUSPENSA',
}

// Situações terminais — uma vez atingidas, não faz sentido continuar
// reconsultando essa licitação periodicamente.
const TERMINAL: SituacaoEnum[] = ['ENCERRADA', 'HOMOLOGADA', 'CANCELADA', 'ANULADA', 'REVOGADA']

interface PNCPCompraStatus {
  situacaoCompraId: number
}

export async function refreshTenderSituacao(tenderId: string): Promise<boolean> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: { id: true, fonte: true, situacao: true, orgaoCnpj: true, encerramentoAt: true, rawJson: true },
  })
  if (!tender || tender.fonte !== 'PNCP' || !tender.orgaoCnpj) return false

  const raw = tender.rawJson as Record<string, unknown>
  const ano = raw.anoCompra as number | undefined
  const sequencial = raw.sequencialCompra as number | undefined
  if (!ano || !sequencial) return false

  const response = await pncpClient.get<PNCPCompraStatus>(
    `/v1/orgaos/${tender.orgaoCnpj}/compras/${ano}/${sequencial}`
  )

  const mapped = SITUACAO_COMPRA_ID_MAP[response.data.situacaoCompraId]
  if (!mapped) {
    console.warn(
      `[SituaçãoUpdate] situacaoCompraId desconhecido (${response.data.situacaoCompraId}) para tender ${tenderId} — mantendo situação atual.`
    )
    return false
  }

  const isPastDeadline = tender.encerramentoAt != null && tender.encerramentoAt.getTime() < Date.now()
  const next: SituacaoEnum = mapped === 'ABERTA' && isPastDeadline ? 'ENCERRADA' : mapped

  if (next === tender.situacao) return false

  await prisma.tender.update({ where: { id: tenderId }, data: { situacao: next } })
  return true
}

// Reconsulta todas as licitações do PNCP que ainda não estão em um estado
// terminal — chamada periodicamente pelo worker (ver workers/index.ts).
// Não usa fila do BullMQ de propósito: é uma varredura simples e o Redis
// já está no limite do plano gratuito (ver README/histórico do projeto).
export async function refreshAllOpenSituacoes(): Promise<{ checked: number; updated: number }> {
  const tenders = await prisma.tender.findMany({
    where: { fonte: 'PNCP', situacao: { notIn: TERMINAL } },
    select: { id: true },
  })

  let updated = 0
  for (const t of tenders) {
    try {
      if (await refreshTenderSituacao(t.id)) updated++
    } catch (err) {
      console.error(`[SituaçãoUpdate] Erro ao atualizar tender ${t.id}:`, err instanceof Error ? err.message : err)
    }
  }

  return { checked: tenders.length, updated }
}
