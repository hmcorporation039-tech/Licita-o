'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRequireSession } from '@/hooks/useRequireSession'
import { api } from '@/lib/api'
import { Paginated, Tender } from '@/lib/types'

function formatValor(v: string | null) {
  if (!v) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function TendersPage() {
  const user = useRequireSession()
  const [data, setData] = useState<Paginated<Tender> | null>(null)
  const [uf, setUf] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (uf) qs.set('uf', uf)
    api
      .get<Paginated<Tender>>(`/api/tenders?${qs.toString()}`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [user, uf, page])

  if (!user) return null

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Licitações coletadas</h1>

      <div className="mb-4 flex items-center gap-2">
        <input
          placeholder="Filtrar por UF (ex: SP)"
          maxLength={2}
          value={uf}
          onChange={(e) => {
            setPage(1)
            setUf(e.target.value.toUpperCase())
          }}
          className="w-48 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        {data && <span className="text-sm text-slate-500">{data.total} licitação(ões) encontrada(s)</span>}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {data?.items.map((t) => (
              <li key={t.id} className="rounded border border-slate-200 bg-white p-4">
                <Link href={`/tenders/${t.id}`} className="font-medium text-blue-700 hover:underline">
                  {t.objetoResumido ?? t.objeto}
                </Link>
                <p className="mt-1 text-sm text-slate-500">
                  {t.fonte} · {t.modalidade} · {t.uf ?? 'UF n/d'} · {t.orgao ?? 'órgão n/d'} · {formatValor(t.valorEstimado)}
                </p>
              </li>
            ))}
          </ul>

          {data && data.totalPages > 1 && (
            <div className="mt-4 flex items-center gap-3 text-sm">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Anterior
              </button>
              <span>
                Página {data.page} de {data.totalPages}
              </span>
              <button
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
