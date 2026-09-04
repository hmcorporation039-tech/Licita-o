'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireSession } from '@/hooks/useRequireSession'
import { api } from '@/lib/api'
import { Paginated, TenderMatch } from '@/lib/types'

function formatValor(v: string | null) {
  if (!v) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function MatchesPage() {
  const user = useRequireSession()
  const [data, setData] = useState<Paginated<TenderMatch> | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(true)

  function load() {
    if (!user) return
    setLoading(true)
    const qs = new URLSearchParams({ page: '1', pageSize: '30' })
    if (unreadOnly) qs.set('unreadOnly', 'true')
    api
      .get<Paginated<TenderMatch>>(`/api/matches?${qs.toString()}`)
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(load, [user, unreadOnly])

  async function markAsRead(matchId: string) {
    if (!user) return
    await api.patch(`/api/matches/${matchId}`, { read: true })
    load()
  }

  if (!user) return null

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Meus matches</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Só não lidos
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : data?.items.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhum match ainda. Cadastre itens monitorados e clique em &quot;Buscar agora&quot; para varrer o
          que já foi coletado.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data?.items.map((m) => (
            <li key={m.id} className={`rounded border p-4 ${m.read ? 'border-slate-200 bg-white' : 'border-blue-300 bg-blue-50'}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500">Item: {m.monitoredItem.name}</p>
                  <Link href={`/tenders/${m.tenderId}`} className="font-medium text-blue-700 hover:underline">
                    {m.tender.objetoResumido ?? m.tender.objeto}
                  </Link>
                  <p className="mt-1 text-sm text-slate-500">
                    {m.tender.fonte} · {m.tender.uf ?? 'UF n/d'} · {formatValor(m.tender.valorEstimado)} · score{' '}
                    {(m.score * 100).toFixed(0)}%
                  </p>
                  {m.matchedKeywords.length > 0 && (
                    <p className="mt-1 text-xs text-slate-400">Palavras: {m.matchedKeywords.join(', ')}</p>
                  )}
                </div>
                {!m.read && (
                  <button onClick={() => markAsRead(m.id)} className="shrink-0 text-sm text-blue-700 hover:underline">
                    Marcar como lido
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
