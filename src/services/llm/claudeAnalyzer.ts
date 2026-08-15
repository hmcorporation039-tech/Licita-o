// ============================================================
// services/llm/claudeAnalyzer.ts — Analisa o edital com a API da Claude
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { ANALYSIS_SCHEMA, AnalysisRefusedError, buildUserContent, EditalAnalysisResult, SYSTEM_PROMPT } from './types'

let anthropicClient: Anthropic | null = null
function getClient(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic()
  return anthropicClient
}

export async function analyzeEdital(objeto: string, text: string): Promise<EditalAnalysisResult> {
  const message = await getClient().messages.create({
    model: process.env.CLAUDE_ANALYSIS_MODEL || 'claude-opus-5',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
    },
    messages: [{ role: 'user', content: buildUserContent(objeto, text) }],
  })

  if (message.stop_reason === 'refusal') {
    throw new AnalysisRefusedError()
  }

  const textBlock = message.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Resposta do modelo não contém o resultado esperado')
  }

  return JSON.parse(textBlock.text) as EditalAnalysisResult
}
