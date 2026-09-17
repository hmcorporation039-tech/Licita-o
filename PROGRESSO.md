# PROGRESSO

Plataforma de Monitoramento de Licitações — PNCP + ComprasNet.

| Legenda | |
|---|---|
| ✅ | Entregue e verificado |
| 🟡 | Entregue, verificação real pendente |
| ⬜ | Não iniciado |

---

## v1.0 — Base funcional

| Item | Status |
|---|---|
| Coleta PNCP (13 modalidades, paginação, isolamento por modalidade) | ✅ |
| Coleta ComprasNet (licitação competitiva + compra sem licitação) | ✅ |
| Normalização entre as duas fontes | ✅ |
| Matching literal com borda de palavra + CATMAT/CATSER | ✅ |
| Filtros: UF, valor, modalidade, órgão, UASG, raio em km | ✅ |
| Autenticação JWT, isolamento por usuário, conta com prazo | ✅ |
| Cofre de documentos da empresa + alerta de vencimento | ✅ |
| Checklist de habilitação (Lei 14.133/2021) | ✅ |
| Plano de participação com marcos recalculados | ✅ |
| Análise de edital por IA (Claude / Gemini) | ✅ |
| Mapa do Brasil com farol de urgência | ✅ |
| Retenção de 90 dias, atualização de situação | ✅ |
| 42 testes E2E (Cypress) | ✅ |

---

## v2.0 — Correção dos 13 defeitos da auditoria

Restrição da fase: **nenhuma correção exigiu crédito de API.** Os Blocos 1 e 2
inteiros, mais todo o código do Bloco 3, foram escritos e verificados offline.
A única chamada paga foi uma execução deliberada de `analise:smoke` na cota
gratuita do Gemini, para validar o Bloco 3 ponta a ponta. A Anthropic não foi
chamada em momento nenhum.

### Bloco 1 — Críticos, segurança e processo

| # | Defeito | Correção | Status |
|---|---|---|---|
| P0-01 | Coleta congelada numa janela de datas fixa — o BullMQ reaproveita o payload do job repetível, então a coleta parava de trazer dado novo sem emitir erro | Janela resolvida no worker em tempo de execução; `upsertJobScheduler` com payload só da fonte; remoção dos agendadores legados presos no Redis | ✅ |
| P0-02 | Licitação nunca atualizada depois de coletada — prazo prorrogado e valor retificado nunca chegavam ao usuário | `saveTender` virou upsert com comparação de hash de conteúdo; aviso de "licitação alterada" para quem acompanha | ✅ |
| P0-03 | Banco não reconstruível — uma migration com 7 tabelas para um schema de 12 modelos | Baseline regerado do schema; `db:push` removido dos scripts; runbook em `MIGRACAO.md` | ✅ |
| P1-09 | Sem rate limit no login, CORS aberto, HTML não escapado em e-mail, sessão de 30 dias sem revogação | `express-rate-limit`, `helmet`, CORS por allowlist, `escapeHtml`/`safeHttpUrl`, revogação via `tokenVersion` | ✅ |
| P2-13 | Nenhum teste unitário do núcleo de valor | `src/lib/matching.ts` extraída e 73 testes Vitest; CI no GitHub Actions sem banco e sem segredo | ✅ |

### Bloco 2 — Escala

| # | Defeito | Correção | Status |
|---|---|---|---|
| P1-04 | Rematch carregava 90 dias de licitações com `rawJson` na memória, dentro de um request HTTP | Portões viraram `WHERE`, `select` sem `rawJson`, paginação por cursor | ✅ |
| P1-05 | Busca do feed fazia varredura completa da tabela | `pg_trgm` + índices GIN nas colunas `*_norm` | ✅ |
| P1-06 | Varredura de situação levava horas e nunca terminava antes da próxima começar | Rodízio por `situacaoCheckedAt`, teto por execução, trava contra sobreposição | ✅ |
| P2-10 | N+1 no dashboard | Uma consulta com `in` | ✅ |
| P2-11 | Filtro por UF descartava silenciosamente todo o ComprasNet | Cruzamento com a tabela `Uasg` para preencher UF, órgão e município | ✅ |
| P2-12 | Mesma janela reprocessada 12×/dia | Cursor pela última publicação coletada, com teto de 30 dias | ✅ |

### Bloco 3 — Caminho da IA

Entregue atrás de `AI_ANALYSIS_ENABLED=false`. **Verificado ponta a ponta com o
Gemini** contra uma licitação real do PNCP (CNPJ 01599409000139, ano 2026,
sequencial 23) em 15/09/2026: 5 documentos, 48 páginas, 27,7s, JSON completo.

O caminho da **Claude** usa outra API (blocos `document`, streaming,
`finalMessage`) e **não foi executado** — passa no typecheck, mas não há
verificação real. Rode `npm run analise:smoke` com `AI_PROVIDER="claude"` antes
de usá-lo em produção.

| # | Defeito | Correção | Status |
|---|---|---|---|
| P1-07 | Edital truncado em 200.000 caracteres e apenas 1 documento analisado — habilitação e Termo de Referência ficavam de fora | Modo híbrido: texto quando há camada de texto, PDF nativo quando é escaneado. Até 5 documentos por prioridade, sem truncamento | ✅ Gemini · ⚠️ Claude |
| P1-08 | Análise rodando dentro da requisição HTTP; `max_tokens` baixo demais | Fila `analise` dedicada, resposta `202`, streaming com `finalMessage()`, `max_tokens` 32k, polling no frontend | ✅ Gemini · ⚠️ Claude |
| — | Priorização de documentos casava com tudo, porque o órgão carimba `tipoDocumentoNome="Edital"` em quase todo anexo — o Termo de Referência ficava fora do corte | Prioridade passa a olhar o título e rebaixar peça administrativa | ✅ |

---

## Verificação da v2.0

| Passo | Resultado |
|---|---|
| `npm run typecheck` | ✅ limpo |
| `npm run test` | ✅ 73 testes, 6 arquivos |
| `next build` (frontend) | ✅ 14 rotas, TypeScript verde |
| Migration baseline | ✅ 12 tabelas, 8 enums, 28+ índices |
| `npm run analise:smoke` (Gemini) | ✅ licitação real do PNCP, 27,7s, JSON completo |

Pendente de ambiente real (ver `MIGRACAO.md`): E2E Cypress, `migrate resolve` em
produção, e a análise de edital pelo caminho da Claude.

---

## Próximas fases (não iniciadas)

| Fase | Escopo | Status |
|---|---|---|
| F2 | **Parecer de habilitação**: cruzar `documentosExigidos` extraído do edital com o cofre de documentos da empresa — "você está habilitado, falta X, e o documento Z vence antes da sessão". A matéria-prima já está toda no banco | ⬜ |
| F2 | Análise automática em lote via Batch API (metade do custo por token) | ⬜ |
| F3 | Resultado, atas e contratos do PNCP; histórico de preço por objeto; perfil de concorrente | ⬜ |
| F3 | Funil de participação com taxa de conversão por item monitorado | ⬜ |
| F4 | Empresa como entidade (cofre e itens compartilhados pelo time) | ⬜ |
| F4 | Resumo diário por e-mail, alerta por WhatsApp, exportação em PDF, planos e limites | ⬜ |

---

## Ajustes conhecidos, ainda não feitos

| O que | Por que importa |
|---|---|
| **Prompt de `documentosExigidos` traz boilerplate.** Na verificação real, 7 dos 9 itens eram declarações padrão do Anexo 02 (não emprego de menor, idoneidade, inexistência de parentes). O prompt em `llm/types.ts` pede o que é específico "além do básico padrão" e isso não foi respeitado | É a entrada do parecer de habilitação da F2. Lista com boilerplate gera ruído no cruzamento com o cofre em vez de resposta útil — vale corrigir **antes** de construir o parecer em cima |
| **`pdfTextService` não tem teste de PDF escaneado real.** A decisão do híbrido é testada por unidade, mas não houve um edital escaneado na amostra | O caminho do PDF nativo nunca foi exercitado ponta a ponta |
