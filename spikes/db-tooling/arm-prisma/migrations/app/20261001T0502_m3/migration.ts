#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0a97774db46f16854da8341479383b568b4b3b2d0196b0c5f73a461f48f9ae4c/contract';
import endContractJson from '../../snapshots/0a97774db46f16854da8341479383b568b4b3b2d0196b0c5f73a461f48f9ae4c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract';
import startContractJson from '../../snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import postgresAdapter from '@prisma/orm-postgres/adapter/runtime';
import { sql } from '@prisma/orm-postgres/builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma/orm-postgres/family-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import { raw } from '../../../scripts/raw-op.ts';

// The null-handling transform reads `name`, which only the start contract has.
const startContract = new PostgresContractSerializer().deserializeContract<Start>(startContractJson);
const stack = createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensions: [pgvector] });
const db = sql<Start>({
  context: createExecutionContext({ contract: startContract, stack }),
  rawCodecInferer: stack.adapter.rawCodecInferer,
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContractJson;
  override readonly endContractJson = endContractJson;

  override get operations() {
    return [
      // FALLBACK: the M2 sync trigger is raw, so dropping it is raw too. It goes first: once
      // `name` is gone the trigger would fail on every write.
      raw(
        'raw.entity.display_name_sync.drop',
        'Drop the trigger keeping "entity".name and display_name in sync',
        ['DROP TRIGGER entity_name_sync ON public.entity', 'DROP FUNCTION public.entity_name_sync()'],
        "SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'entity_name_sync') AS result",
      ),
      // Moved ahead of dropColumn (the planner put it after), so it can still read `name`.
      this.dataTransform(startContract, 'handle-nulls-entity-display_name', {
        check: () =>
          db.public.entity
            .select('id')
            .where((f, fns) => fns.eq(f.display_name, null))
            .limit(1),
        run: () =>
          db.public.entity
            .update((f) => ({ display_name: f.name }))
            .where((f, fns) => fns.eq(f.display_name, null)),
      }),
      this.dropColumn({ schema: 'public', table: 'entity', column: 'name' }),
      this.setNotNull({ schema: 'public', table: 'entity', column: 'display_name' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
