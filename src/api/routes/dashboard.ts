// ============================================================
// api/routes/dashboard.ts — Visão geral do usuário logado: itens
// monitorados, matches recentes, documentos vencendo, próximos prazos
// dos planos de participação em andamento.
// ============================================================

import { Router } from 'express'
import { prisma } from '../../services/tenderService'
import { buildAutoMilestones } from '../../lib/participationPlanTemplate'
import { asyncHandler } from '../asyncHandler'

export const dashboardRouter = Router()

const DOC_ALERT_DAYS = 15
const PRAZO_JANELA_DIAS = 14

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.userId!

    const [itensAtivos, matchesNaoLidos, matchesTotal, ultimosMatches, documentos, planos] = await Promise.all([
      prisma.monitoredItem.count({ where: { userId, active: true } }),
      prisma.tenderMatch.count({ where: { userId, read: false } }),
      prisma.tenderMatch.count({ where: { userId } }),
      prisma.tenderMatch.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { tender: true, monitoredItem: { select: { name: true } } },
      }),
      prisma.companyDocument.findMany({ where: { userId, dataValidade: { not: null } } }),
      prisma.tenderParticipationPlan.findMany({
        where: { userId, status: { in: ['AVALIANDO', 'VOU_PARTICIPAR'] } },
        include: {
          tender: { select: { id: true, objeto: true, objetoResumido: true, publicadoAt: true, encerramentoAt: true, aberturaAt: true } },
        },
      }),
    ])

    const now = Date.now()
    const docAlertCutoff = now + DOC_ALERT_DAYS * 24 * 60 * 60 * 1000
    const documentosVencendoEmBreve = documentos
      .filter((d) => d.dataValidade && d.dataValidade.getTime() <= docAlertCutoff)
      .map((d) => ({ id: d.id, nome: d.nome, dataValidade: d.dataValidade }))
      .sort((a, b) => (a.dataValidade!.getTime() - b.dataValidade!.getTime()))

    const prazoCutoff = now + PRAZO_JANELA_DIAS * 24 * 60 * 60 * 1000
    const proximosPrazos: { tenderId: string; tenderObjeto: string; label: string; date: string }[] = []
    for (const plano of planos) {
      const analysis = await prisma.tenderAnalysis.findUnique({ where: { tenderId: plano.tenderId } })
      const analysisPrazos =
        analysis?.status === 'DONE' && analysis.resultado
          ? (analysis.resultado as unknown as { prazoImpugnacao: string; prazoEsclarecimento: string })
          : null
      const milestones = buildAutoMilestones(plano.tender, analysisPrazos)
      for (const m of milestones) {
        if (m.done || !m.date) continue
        const t = new Date(m.date).getTime()
        if (t >= now && t <= prazoCutoff) {
          proximosPrazos.push({
            tenderId: plano.tender.id,
            tenderObjeto: plano.tender.objetoResumido ?? plano.tender.objeto,
            label: m.label,
            date: m.date,
          })
        }
      }
    }
    proximosPrazos.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    res.json({
      itensMonitoradosAtivos: itensAtivos,
      matchesNaoLidos,
      matchesTotal,
      ultimosMatches,
      documentosVencendoEmBreve,
      proximosPrazos,
    })
  })
)
