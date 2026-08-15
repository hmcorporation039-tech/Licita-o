# Plataforma de Monitoramento de Licitações

Monitora licitações vigentes do **PNCP** e **ComprasNet** por itens previamente cadastrados.

---

## Pré-requisitos

- Node.js 20+
- Docker (para Redis local)
- Conta no [Supabase](https://supabase.com) (banco PostgreSQL)
- VS Code com extensão **Prisma** instalada

---

## 1. Clonar / abrir o projeto no VS Code

```bash
# Se for um repositório Git
git clone <seu-repo>
cd licitacao-platform

# Ou simplesmente abra a pasta no VS Code
code .
```

---

## 2. Instalar dependências

```bash
npm install
```

---

## 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` e preencha:

| Variável | Onde obter |
|---|---|
| `DATABASE_URL` | Dashboard Supabase → Settings → Database → Connection string |
| `REDIS_URL` | `redis://localhost:6379` para dev local |

---

## 4. Subir Redis local com Docker

```bash
docker run -d --name redis-licitacao -p 6379:6379 redis:7-alpine
```

Para verificar se está rodando:

```bash
docker ps
```

---

## 5. Configurar o banco de dados

```bash
# Gera o Prisma Client
npm run db:generate

# Aplica o schema no banco (cria as tabelas)
npm run db:migrate
```

> **Supabase:** Após rodar o migrate, acesse o Supabase Studio para ver as tabelas criadas.

---

## 6. Ativar pg_trgm no Supabase (busca fuzzy)

No Supabase Studio → SQL Editor, execute:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice para busca por similaridade no campo objeto
CREATE INDEX IF NOT EXISTS idx_tenders_objeto_trgm
  ON tenders USING gin(objeto gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tender_items_descricao_trgm
  ON tender_items USING gin(descricao gin_trgm_ops);
```

---

## 7. Rodar os workers em desenvolvimento

```bash
npm run dev:workers
```

Você verá no terminal:
```
🚀 Iniciando workers da plataforma de licitações...
✅ Workers ativos: PNCP, ComprasNet
📥 Coleta inicial disparada (últimos 2 dias).
[PNCP Worker] Iniciando coleta 2025-08-08 → 2025-08-10
[ComprasNet Worker] Iniciando coleta 2025-08-08 → 2025-08-10
```

---

## 8. Visualizar a fila (opcional)

Instale o Bull Board para visualizar jobs em tempo real:

```bash
npm install @bull-board/express @bull-board/api
```

Depois crie `src/dashboard.ts`:

```ts
import express from 'express'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { coletorQueue, matcherQueue } from './queues'

const serverAdapter = new ExpressAdapter()
serverAdapter.setBasePath('/admin/queues')

createBullBoard({
  queues: [new BullMQAdapter(coletorQueue), new BullMQAdapter(matcherQueue)],
  serverAdapter,
})

const app = express()
app.use('/admin/queues', serverAdapter.getRouter())
app.listen(3001, () => console.log('Bull Board: http://localhost:3001/admin/queues'))
```

```bash
npx ts-node src/dashboard.ts
# Acesse: http://localhost:3001/admin/queues
```

---

## Estrutura do projeto

```
licitacao-platform/
├── prisma/
│   └── schema.prisma          ← Schema do banco
├── src/
│   ├── types/index.ts         ← Tipos TypeScript compartilhados
│   ├── lib/
│   │   └── httpClient.ts      ← Cliente HTTP com rate limiting
│   ├── queues/
│   │   └── index.ts           ← BullMQ + Redis
│   ├── services/
│   │   ├── pncpParser.ts      ← Normaliza JSON do PNCP
│   │   ├── comprasnetParser.ts← Normaliza JSON do ComprasNet
│   │   └── tenderService.ts   ← Persiste no banco via Prisma
│   └── workers/
│       ├── coletorPNCP.ts     ← Worker coleta PNCP
│       ├── coletorComprasnet.ts← Worker coleta ComprasNet
│       └── index.ts           ← Entrypoint
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## Próximos passos (próximas fases)

- [ ] **Agente Matcher** — cruza licitações com itens monitorados do usuário
- [ ] **Agente Notificador** — envia e-mail via Resend quando há match
- [ ] **API REST** — endpoints para o frontend (Next.js)
- [ ] **Frontend** — painel de cadastro de itens e feed de licitações
- [ ] **Agente Deduplicador** — detecta licitações que aparecem nas duas fontes

---

## APIs utilizadas

| Fonte | URL base | Auth |
|---|---|---|
| PNCP | `https://pncp.gov.br/api/consulta` | Pública |
| ComprasNet | `https://dadosabertos.compras.gov.br` | Pública |
| CATMAT/CATSER | `https://compras.dados.gov.br` | Pública |
