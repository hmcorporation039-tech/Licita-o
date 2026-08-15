'use client'

import { use, useEffect, useState } from 'react'
import { useRequireSession } from '@/hooks/useRequireSession'
import { api, ApiRequestError } from '@/lib/api'
import { ChecklistItem, Tender, TenderAnalysis, TenderChecklist } from '@/lib/types'

const SEVERIDADE_STYLE: Record<string, string> = {
  alta: 'border-red-300 bg-red-50 text-red-900',
  media: 'border-amber-300 bg-amber-50 text-amber-900',
  baixa: 'border-slate-300 bg-slate-50 text-slate-700',
}

function formatValor(v: string | null) {
  if (!v) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function groupBySection(items: ChecklistItem[]) {
  const sections = new Map<string, ChecklistItem[]>()
  for (const item of items) {
    if (!sections.has(item.section)) sections.set(item.section, [])
    sections.get(item.section)!.push(item)
  }
  return Array.from(sections.entries())
}

export default function TenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const user = useRequireSession()

  const [tender, setTender] = useState<Tender | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newItemLabel, setNewItemLabel] = useState('')

  const [analysis, setAnalysis] = useState<TenderAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      api.get<Tender>(`/api/tenders/${id}`),
      api.get<TenderChecklist>(`/api/tenders/${id}/checklist?userId=${user.id}`),
    ])
      .then(([tenderData, checklistData]) => {
        setTender(tenderData)
        setItems(checklistData.items)
      })
      .finally(() => setLoading(false))

    api
      .get<TenderAnalysis>(`/api/tenders/${id}/analysis`)
      .then(setAnalysis)
      .catch((err) => {
        if (!(err instanceof ApiRequestError && err.status === 404)) {
          console.error(err)
        }
      })
  }, [id, user])

  async function runAnalysis(force: boolean) {
    setAnalyzing(true)
    try {
      const result = await api.post<TenderAnalysis>(`/api/tenders/${id}/analyze${force ? '?force=true' : ''}`)
      setAnalysis(result)
    } catch (err) {
      alert(err instanceof ApiRequestError ? err.message : 'Erro ao analisar o edital')
    } finally {
      setAnalyzing(false)
    }
  }

  function addChecklistItem(label: string) {
    if (items.some((i) => i.label === label)) return
    const next = [
      ...items,
      {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        section: 'Documentos Adicionais do Seu Edital',
        label,
        checked: false,
        custom: true,
      },
    ]
    setItems(next)
    persist(next)
  }

  async function persist(nextItems: ChecklistItem[]) {
    if (!user) return
    setSaving(true)
    try {
      await api.put(`/api/tenders/${id}/checklist`, { userId: user.id, items: nextItems })
    } finally {
      setSaving(false)
    }
  }

  function toggleItem(itemId: string) {
    const next = items.map((i) => (i.id === itemId ? { ...i, checked: !i.checked } : i))
    setItems(next)
    persist(next)
  }

  function addCustomItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newItemLabel.trim()) return
    const next = [
      ...items,
      {
        id: `custom-${Date.now()}`,
        section: 'Documentos Adicionais do Seu Edital',
        label: newItemLabel.trim(),
        checked: false,
        custom: true,
      },
    ]
    setItems(next)
    setNewItemLabel('')
    persist(next)
  }

  function removeCustomItem(itemId: string) {
    const next = items.filter((i) => i.id !== itemId)
    setItems(next)
    persist(next)
  }

  if (!user || loading) return <p className="text-sm text-slate-500">Carregando...</p>
  if (!tender) return <p className="text-sm text-red-600">Licitação não encontrada.</p>

  const total = items.length
  const done = items.filter((i) => i.checked).length

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded border border-slate-200 bg-white p-4">
        <h1 className="text-lg font-semibold">{tender.objetoResumido ?? tender.objeto}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tender.fonte} · {tender.modalidade} · {tender.uf ?? 'UF n/d'} · {tender.orgao ?? 'órgão n/d'} ·{' '}
          {formatValor(tender.valorEstimado)}
        </p>
        {tender.linkEdital && (
          <a href={tender.linkEdital} target="_blank" className="mt-2 inline-block text-sm text-blue-700 hover:underline">
            Ver edital original
          </a>
        )}
        <details className="mt-3 text-sm text-slate-600">
          <summary className="cursor-pointer text-slate-500">Objeto completo</summary>
          <p className="mt-2 whitespace-pre-wrap">{tender.objeto}</p>
        </details>
      </section>

      {tender.items && tender.items.length > 0 && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-lg font-semibold">Itens da licitação</h2>
          <p className="mb-3 text-sm text-slate-500">
            Códigos CATMAT/CATSER de cada item — use pra cadastrar um item monitorado com match exato, sem
            depender de palavra-chave.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                  <th className="py-1 pr-3">Descrição</th>
                  <th className="py-1 pr-3">CATMAT</th>
                  <th className="py-1 pr-3">CATSER</th>
                  <th className="py-1 pr-3">Qtd.</th>
                  <th className="py-1">Valor unit.</th>
                </tr>
              </thead>
              <tbody>
                {tender.items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="py-2 pr-3">{it.descricao}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{it.catmatCode ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{it.catserCode ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {it.quantidade ?? '—'} {it.unidadeMedida ?? ''}
                    </td>
                    <td className="py-2">{formatValor(it.valorUnitario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Análise do edital (IA)</h2>
          {analysis?.status === 'DONE' && (
            <button
              onClick={() => runAnalysis(true)}
              disabled={analyzing}
              className="text-sm text-blue-700 hover:underline disabled:opacity-50"
            >
              Reanalisar
            </button>
          )}
        </div>

        {!analysis && !analyzing && (
          <div>
            <p className="mb-3 text-sm text-slate-500">
              Baixa o edital publicado no PNCP e usa IA para resumir valor, prazo, critério de julgamento,
              exigências técnicas e pontos de atenção — pode levar até 30 segundos.
            </p>
            <button
              onClick={() => runAnalysis(false)}
              className="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              Analisar edital com IA
            </button>
          </div>
        )}

        {analyzing && <p className="text-sm text-slate-500">Baixando e analisando o edital...</p>}

        {!analyzing && analysis?.status === 'NO_DOCUMENTS' && (
          <p className="text-sm text-slate-500">{analysis.errorMsg ?? 'Nenhum documento disponível para análise.'}</p>
        )}

        {!analyzing && analysis?.status === 'FAILED' && (
          <div>
            <p className="mb-3 text-sm text-red-600">{analysis.errorMsg ?? 'A análise falhou.'}</p>
            <button
              onClick={() => runAnalysis(true)}
              className="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {!analyzing && analysis?.status === 'DONE' && analysis.resultado && (
          <div className="flex flex-col gap-4">
            {analysis.documentoNome && (
              <p className="text-xs text-slate-400">Documento analisado: {analysis.documentoNome}</p>
            )}
            <p className="text-sm text-slate-700">{analysis.resultado.resumo}</p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded border border-slate-200 p-3">
                <p className="text-xs text-slate-400">Valor estimado</p>
                <p className="text-sm">{analysis.resultado.valorEstimado}</p>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <p className="text-xs text-slate-400">Prazo de entrega</p>
                <p className="text-sm">{analysis.resultado.prazoEntrega}</p>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <p className="text-xs text-slate-400">Critério de julgamento</p>
                <p className="text-sm">{analysis.resultado.criterioJulgamento}</p>
              </div>
            </div>

            {analysis.resultado.exigenciasTecnicas.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-800">Exigências técnicas</p>
                <ul className="list-inside list-disc text-sm text-slate-600">
                  {analysis.resultado.exigenciasTecnicas.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.resultado.documentosExigidos.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-800">
                  Documentos específicos deste edital (além do checklist padrão)
                </p>
                <ul className="flex flex-col gap-1 text-sm text-slate-600">
                  {analysis.resultado.documentosExigidos.map((doc, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span>{doc}</span>
                      <button
                        onClick={() => addChecklistItem(doc)}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        + adicionar ao checklist
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.resultado.riscos.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-800">Pontos de atenção</p>
                <div className="flex flex-col gap-2">
                  {analysis.resultado.riscos.map((r, i) => (
                    <div key={i} className={`rounded border p-3 text-sm ${SEVERIDADE_STYLE[r.severidade] ?? SEVERIDADE_STYLE.baixa}`}>
                      <p className="font-medium">
                        ⚠ {r.titulo} <span className="text-xs font-normal">({r.severidade})</span>
                      </p>
                      <p className="mt-1">{r.descricao}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Checklist de habilitação</h2>
          <span className="text-sm text-slate-500">
            {done}/{total} documentos {saving && '· salvando...'}
          </span>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          Baseado no guia de habilitação da Lei 14.133/2021. Personalize adicionando os documentos
          específicos exigidos neste edital.
        </p>

        <div className="flex flex-col gap-5">
          {groupBySection(items).map(([section, sectionItems]) => (
            <div key={section} className="rounded border border-slate-200 bg-white p-4">
              <h3 className="mb-2 font-medium text-slate-800">{section}</h3>
              <ul className="flex flex-col gap-2">
                {sectionItems.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => toggleItem(item.id)}
                      className="mt-0.5"
                    />
                    <span>
                      {item.label}
                      {item.hint && <span className="text-slate-400"> — {item.hint}</span>}
                    </span>
                    {item.custom && (
                      <button
                        onClick={() => removeCustomItem(item.id)}
                        className="ml-auto text-xs text-red-600 hover:underline"
                      >
                        remover
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <form onSubmit={addCustomItem} className="mt-4 flex gap-2">
          <input
            placeholder="Adicionar documento específico deste edital"
            value={newItemLabel}
            onChange={(e) => setNewItemLabel(e.target.value)}
            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800">
            Adicionar
          </button>
        </form>
      </section>
    </div>
  )
}
