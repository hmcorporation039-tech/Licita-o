// ============================================================
// scripts/migrarProducao.ts — Migra o banco da v1.0 para a v2.0 em um
// comando só, sem precisar decidir nada na hora.
//
// O que ele resolve: o banco de produção já tem as tabelas do baseline,
// mas nunca soube disso (tudo foi aplicado com `prisma db push`, que não
// deixa histórico). Rodar `migrate deploy` direto falha tentando recriar
// o que já existe. Este script detecta a situação e faz o certo.
//
// Uso:
//   DATABASE_URL="postgresql://..." npm run migrar:producao
//   DATABASE_URL="postgresql://..." npm run migrar:producao -- --dry
// ============================================================

import 'dotenv/config'
import { execFileSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

const BASELINE = '00000000000000_baseline'
const dry = process.argv.includes('--dry')

function rodar(args: string[]): void {
  console.log(`\n$ npx prisma ${args.join(' ')}`)
  if (dry) {
    console.log('  (--dry: não executado)')
    return
  }
  execFileSync('npx', ['prisma', ...args], { stdio: 'inherit', shell: true })
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definida. Exporte a do banco que você quer migrar.')
    process.exit(1)
  }

  const alvo = process.env.DATABASE_URL.replace(/\/\/[^@]*@/, '//***:***@')
  console.log(`Banco: ${alvo}`)
  if (dry) console.log('Modo --dry: mostra o plano e não altera nada.\n')

  const prisma = new PrismaClient()

  let bancoTemTabelas = false
  let baselineRegistrado = false

  try {
    const tabelas = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'tenders'
    `
    bancoTemTabelas = Number(tabelas[0]?.n ?? 0) > 0

    if (bancoTemTabelas) {
      const registros = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM _prisma_migrations WHERE migration_name = ${BASELINE}
      `.catch(() => [{ n: BigInt(0) }])
      baselineRegistrado = Number(registros[0]?.n ?? 0) > 0
    }
  } catch (err) {
    console.error('\nNão consegui consultar o banco:', err instanceof Error ? err.message : err)
    console.error('Confira a DATABASE_URL (em produção, use o endpoint com TCP proxy).')
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }

  if (!bancoTemTabelas) {
    console.log('\nBanco vazio — aplicando todas as migrations do zero.')
    rodar(['migrate', 'deploy'])
  } else if (!baselineRegistrado) {
    console.log('\nBanco já tem as tabelas mas não tem histórico de migration.')
    console.log('Marcando o baseline como aplicado (não altera nenhuma tabela)...')
    rodar(['migrate', 'resolve', '--applied', BASELINE])
    rodar(['migrate', 'deploy'])
  } else {
    console.log('\nBaseline já registrado — aplicando só o que falta.')
    rodar(['migrate', 'deploy'])
  }

  if (dry) {
    console.log('\n--dry: nada foi alterado. Rode sem --dry para valer.\n')
    return
  }

  console.log('\nPreenchendo as colunas normalizadas dos registros antigos...')
  execFileSync('npx', ['ts-node', 'scripts/backfillNormColumns.ts'], { stdio: 'inherit', shell: true })

  console.log('\nPronto. Confira a coleta nas próximas horas com:')
  console.log(
    '  SELECT worker, started_at, total_new, total_updated FROM worker_logs ORDER BY started_at DESC LIMIT 10;'
  )
  console.log('  total_new voltando a crescer = P0-01 resolvido.\n')
}

main().catch((err) => {
  console.error('\nFalhou:', err instanceof Error ? err.message : err)
  process.exit(1)
})
