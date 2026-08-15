// ============================================================
// services/llm/types.ts — Contrato comum entre os analisadores de
// edital (Claude e Gemini, por enquanto) + schema/prompt compartilhados.
// Trocar de provedor é só mudar AI_PROVIDER no .env — ver
// editalAnalysisService.ts.
// ============================================================

export interface EditalAnalysisRisco {
  titulo: string
  descricao: string
  severidade: 'alta' | 'media' | 'baixa'
}

export interface EditalAnalysisResult {
  resumo: string
  valorEstimado: string
  prazoEntrega: string
  criterioJulgamento: string
  prazoImpugnacao: string
  prazoEsclarecimento: string
  exigenciasTecnicas: string[]
  documentosExigidos: string[]
  riscos: EditalAnalysisRisco[]
}

// Schema JSON — usado tanto pelo output_config.format da Claude quanto
// pelo responseSchema do Gemini (formato compatível entre os dois).
export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    resumo: { type: 'string' },
    valorEstimado: { type: 'string' },
    prazoEntrega: { type: 'string' },
    criterioJulgamento: { type: 'string' },
    prazoImpugnacao: { type: 'string' },
    prazoEsclarecimento: { type: 'string' },
    exigenciasTecnicas: { type: 'array', items: { type: 'string' } },
    documentosExigidos: { type: 'array', items: { type: 'string' } },
    riscos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          descricao: { type: 'string' },
          severidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        },
        required: ['titulo', 'descricao', 'severidade'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'resumo',
    'valorEstimado',
    'prazoEntrega',
    'criterioJulgamento',
    'prazoImpugnacao',
    'prazoEsclarecimento',
    'exigenciasTecnicas',
    'documentosExigidos',
    'riscos',
  ],
  additionalProperties: false,
} as const

export const SYSTEM_PROMPT = `Você é um analista especialista em licitações públicas brasileiras (Lei nº 14.133/2021).
Leia o edital fornecido e produza uma análise minuciosa e objetiva para uma empresa que está avaliando participar.

Extraia:
- resumo: 2-3 frases sobre o objeto da licitação
- valorEstimado, prazoEntrega, criterioJulgamento: extraia do texto; escreva "não especificado no edital" se não encontrar
- prazoImpugnacao: prazo e forma de impugnar o edital (ex: "até 3 dias úteis antes da abertura da sessão" ou uma data específica, se o edital indicar uma). Escreva "não especificado no edital" se não encontrar.
- prazoEsclarecimento: prazo e forma de pedir esclarecimentos sobre o edital (mesma lógica do prazoImpugnacao — pode ser uma regra relativa à data da sessão, ou uma data absoluta). Escreva "não especificado no edital" se não encontrar.
- exigenciasTecnicas: lista de exigências de qualificação técnica (atestados, registros em conselho de classe, etc.)
- documentosExigidos: documentos de habilitação exigidos NESTE edital além do básico padrão (contrato social, certidões federais/estaduais/municipais, CNDT, FGTS) — ou seja, o que é ESPECÍFICO deste edital: garantias, declarações incomuns, vistoria obrigatória, qualificação econômico-financeira com índices específicos, etc.
- riscos: pontos de atenção reais encontrados no texto, no estilo de auditoria de concorrência — exemplos do que procurar: exigência de atestado técnico com critérios muito restritivos, planilha de custos com prazo de preenchimento apertado, exigência de visita técnica obrigatória com prazo curto, cláusulas de habilitação que podem restringir a competitividade indevidamente, valores ou prazos incomuns, exigências de qualificação econômico-financeira desproporcionais ao objeto. Marque severidade "alta" só para riscos que podem de fato inabilitar ou prejudicar uma proposta.

Seja específico e cite trechos do edital quando relevante. Não invente informação que não está no texto.`

export function buildUserContent(objeto: string, text: string): string {
  return `Objeto da licitação (conforme cadastro no PNCP): ${objeto}\n\n--- TEXTO DO EDITAL ---\n\n${text}`
}

// Erro específico pra quando o próprio modelo recusa a análise (filtro de
// segurança) — tratado separado de erro genérico pelo orquestrador.
export class AnalysisRefusedError extends Error {
  constructor() {
    super('A análise foi recusada pelos filtros de segurança do modelo.')
  }
}
