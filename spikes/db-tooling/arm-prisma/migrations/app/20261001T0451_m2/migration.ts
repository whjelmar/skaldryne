#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/b4c11737c4774575acc639908163c539bdba2997572ffa13f28883608db2f512/contract';
import startContractJson from '../../snapshots/b4c11737c4774575acc639908163c539bdba2997572ffa13f28883608db2f512/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract';
import endContractJson from '../../snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';
import postgresAdapter from '@prisma/orm-postgres/adapter/runtime';
import { sql } from '@prisma/orm-postgres/builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma/orm-postgres/family-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import pgvector from '@prisma/orm-extension-pgvector/runtime';
import { raw } from '../../../scripts/raw-op.ts';

const endContract = new PostgresContractSerializer().deserializeContract<End>(endContractJson);
const stack = createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensions: [pgvector] });
const db = sql<End>({
  context: createExecutionContext({ contract: endContract, stack }),
  rawCodecInferer: stack.adapter.rawCodecInferer,
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContractJson;
  override readonly endContractJson = endContractJson;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'entity',
        column: col('display_name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dropNotNull({ schema: 'public', table: 'entity', column: 'name' }),
      // FALLBACK: triggers are not part of the contract. The sync trigger is created before the
      // backfill so rows written while the migration runs are covered as well.
      raw(
        'raw.entity.display_name_sync',
        'Create trigger keeping "entity".name and display_name in sync',
        [
          `CREATE FUNCTION public.entity_name_sync() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.display_name := COALESCE(NEW.display_name, NEW.name);
    NEW.name := COALESCE(NEW.name, NEW.display_name);
  ELSIF NEW.name IS DISTINCT FROM OLD.name AND NEW.display_name IS NOT DISTINCT FROM OLD.display_name THEN
    NEW.display_name := NEW.name;
  ELSIF NEW.display_name IS DISTINCT FROM OLD.display_name AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
    NEW.name := NEW.display_name;
  END IF;
  RETURN NEW;
END $fn$`,
          `CREATE TRIGGER entity_name_sync BEFORE INSERT OR UPDATE ON public.entity
  FOR EACH ROW EXECUTE FUNCTION public.entity_name_sync()`,
        ],
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'entity_name_sync') AS result",
      ),
      this.dataTransform(endContract, 'backfill-entity-display_name', {
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
