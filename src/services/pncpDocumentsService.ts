// ============================================================
// services/pncpDocumentsService.ts — Lista e baixa os arquivos
// (edital, anexos, avisos) de uma contratação publicada no PNCP.
// Endpoint público, sem autenticação — descoberto empiricamente em
// 2026-08-10 (não documentado na API de consulta, vive em /api/pncp).
// ============================================================

import axios from 'axios'

export interface PNCPDocumentInfo {
  uri: string
  titulo: string
  sequencialDocumento: number
  tipoDocumentoNome: string
  statusAtivo: boolean
}

// Lista os documentos publicados para uma contratação
export async function listPNCPDocuments(
  cnpj: string,
  anoCompra: number | string,
  sequencialCompra: number | string
): Promise<PNCPDocumentInfo[]> {
  const url = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${anoCompra}/${sequencialCompra}/arquivos`
  const response = await axios.get(url, { timeout: 20_000 })
  return Array.isArray(response.data) ? response.data : []
}

// Baixa o conteúdo binário de um documento (normalmente PDF)
export async function downloadPNCPDocument(uri: string): Promise<Buffer> {
  const response = await axios.get(uri, { responseType: 'arraybuffer', timeout: 30_000 })
  return Buffer.from(response.data)
}

// Escolhe o documento mais relevante para análise: prioriza o "Edital"
// propriamente dito; cai para o primeiro documento ativo se não achar.
export function pickMainDocument(docs: PNCPDocumentInfo[]): PNCPDocumentInfo | undefined {
  const ativos = docs.filter((d) => d.statusAtivo)
  if (ativos.length === 0) return undefined

  const edital = ativos.find((d) => /edital/i.test(d.titulo) || /edital/i.test(d.tipoDocumentoNome))
  return edital ?? ativos[0]
}
