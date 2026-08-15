// ============================================================
// lib/types.ts — Tipos espelhando as respostas da API
// ============================================================

export interface User {
  id: string
  email: string
  name: string | null
}

export interface MonitoredItem {
  id: string
  userId: string
  name: string
  keywords: string[]
  catmatCodes: string[]
  catserCodes: string[]
  ufs: string[]
  valorMin: string | null
  valorMax: string | null
  modalidades: string[]
  active: boolean
  raioKm: number | null
  origemMunicipio: string | null
  origemUf: string | null
  createdAt: string
}

export interface TenderItem {
  id: string
  numeroItem: number | null
  descricao: string
  catmatCode: string | null
  catserCode: string | null
  unidadeMedida: string | null
  quantidade: string | null
  valorUnitario: string | null
  valorTotal: string | null
}

export interface Tender {
  id: string
  fonte: 'PNCP' | 'COMPRASNET'
  modalidade: string
  situacao: string
  objeto: string
  objetoResumido: string | null
  valorEstimado: string | null
  uf: string | null
  municipio: string | null
  orgao: string | null
  aberturaAt: string | null
  publicadoAt: string | null
  linkEdital: string | null
  createdAt: string
  items?: TenderItem[]
}

export interface TenderMatch {
  id: string
  tenderId: string
  monitoredItemId: string
  userId: string
  score: number
  matchedKeywords: string[]
  read: boolean
  createdAt: string
  tender: Tender
  monitoredItem: MonitoredItem
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ChecklistItem {
  id: string
  section: string
  label: string
  hint?: string
  checked: boolean
  custom: boolean
}

export interface TenderChecklist {
  id: string
  userId: string
  tenderId: string
  items: ChecklistItem[]
}

export type AnalysisStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'NO_DOCUMENTS'

export interface AnalysisRisco {
  titulo: string
  descricao: string
  severidade: 'alta' | 'media' | 'baixa'
}

export interface AnalysisResultado {
  resumo: string
  valorEstimado: string
  prazoEntrega: string
  criterioJulgamento: string
  exigenciasTecnicas: string[]
  documentosExigidos: string[]
  riscos: AnalysisRisco[]
}

export interface TenderAnalysis {
  id: string
  tenderId: string
  status: AnalysisStatus
  documentoNome: string | null
  resultado: AnalysisResultado | null
  errorMsg: string | null
}
