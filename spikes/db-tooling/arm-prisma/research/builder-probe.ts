// Probe: which query-builder forms compile for the M2 backfill (run with node).
import type { Contract as End } from '../migrations/snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract';
import endContractJson from '../migrations/snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract.json' with { type: 'json' };
import postgresAdapter from '@prisma/orm-postgres/adapter/runtime';
import { sql } from '@prisma/orm-postgres/builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma/orm-postgres/family-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';

const endContract = new PostgresContractSerializer().deserializeContract<End>(endContractJson);
const stack = createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensions: [pgvector] });
const db = sql<End>({ context: createExecutionContext({ contract: endContract, stack }), rawCodecInferer: stack.adapter.rawCodecInferer });

const tries: Record<string, () => unknown> = {
  checkEqNull: () => db.public.entity.select('id').where((f, fns) => fns.eq(f.displayName, null)).limit(1).build(),
  checkEqNullStorageName: () => db.public.entity.select('id').where((f, fns) => fns.eq((f as any).display_name, null)).limit(1).build(),
  fieldKeys: () => db.public.entity.select('id').where((f, fns) => { console.log('keys', Object.keys(f)); return fns.eq(f.kind, 'x'); }).build(),
  updateCallbackColumn: () => db.public.entity.update((f) => ({ displayName: f.name })).build(),
  updateCallbackRaw: () => db.public.entity.update((f, fns) => ({ displayName: fns.raw`${f.name}`.returns('pg/text@1') })).build(),
};
for (const [k, fn] of Object.entries(tries)) {
  try { const p = fn() as { sql?: string; ast?: unknown }; console.log(k, 'OK', JSON.stringify(p).slice(0, 300)); }
  catch (e) { console.log(k, 'FAIL', (e as Error).message, '\n', (e as Error).stack?.split('\n').slice(1, 6).join('\n')); }
}
