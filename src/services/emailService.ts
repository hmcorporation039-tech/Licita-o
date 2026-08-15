// ============================================================
// services/emailService.ts — Envio de e-mail via Resend
// ============================================================

import { Resend } from 'resend'

const EMAIL_FROM = process.env.EMAIL_FROM ?? 'noreply@seudominio.com.br'

let resend: Resend | null = null
function getResendClient(): Resend {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY)
  return resend
}

export interface MatchEmailParams {
  to: string
  itemName: string
  tenderObjeto: string
  orgao?: string | null
  uf?: string | null
  valorEstimado?: number | null
  linkEdital?: string | null
}

export async function sendMatchEmail(params: MatchEmailParams) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[emailService] RESEND_API_KEY não configurada — e-mail não enviado.')
    return
  }

  const { to, itemName, tenderObjeto, orgao, uf, valorEstimado, linkEdital } = params

  await getResendClient().emails.send({
    from: EMAIL_FROM,
    to,
    subject: `Nova licitação encontrada: ${itemName}`,
    html: `
      <h2>Encontramos uma licitação para "${itemName}"</h2>
      <p><strong>Objeto:</strong> ${tenderObjeto}</p>
      ${orgao ? `<p><strong>Órgão:</strong> ${orgao}</p>` : ''}
      ${uf ? `<p><strong>UF:</strong> ${uf}</p>` : ''}
      ${valorEstimado ? `<p><strong>Valor estimado:</strong> R$ ${valorEstimado.toLocaleString('pt-BR')}</p>` : ''}
      ${linkEdital ? `<p><a href="${linkEdital}">Ver edital</a></p>` : ''}
    `,
  })
}

export interface DocumentExpiryEmailParams {
  to: string
  documentName: string
  diasRestantes: number
  dataValidade: Date
}

export async function sendDocumentExpiryEmail(params: DocumentExpiryEmailParams) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[emailService] RESEND_API_KEY não configurada — e-mail não enviado.')
    return
  }

  const { to, documentName, diasRestantes, dataValidade } = params
  const vencido = diasRestantes < 0
  const dataFormatada = dataValidade.toLocaleDateString('pt-BR')

  await getResendClient().emails.send({
    from: EMAIL_FROM,
    to,
    subject: vencido
      ? `Documento vencido: ${documentName}`
      : `Documento vencendo em ${diasRestantes} dia(s): ${documentName}`,
    html: `
      <h2>${vencido ? 'Documento vencido' : 'Documento próximo do vencimento'}</h2>
      <p><strong>Documento:</strong> ${documentName}</p>
      <p><strong>Validade:</strong> ${dataFormatada} ${vencido ? '(já venceu)' : `(em ${diasRestantes} dia(s))`}</p>
      <p>Renove esse documento pra não perder o prazo de nenhuma licitação em andamento.</p>
    `,
  })
}
