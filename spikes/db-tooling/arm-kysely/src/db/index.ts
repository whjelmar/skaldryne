import { Kysely, PostgresDialect, type Transaction } from "kysely";
import pg from "pg";
import { url, MAIN_DB, type Role } from "../config.ts";
import type { DB } from "./types.ts";

export type { DB } from "./types.ts";

export function createDb<Schema = DB>(
  opts: { database?: string; role?: Role; poolSize?: number } = {},
): Kysely<Schema> {
  const pool = new pg.Pool({
    connectionString: url(opts.role ?? "skal_app", opts.database ?? MAIN_DB),
    max: opts.poolSize ?? 10,
  });
  return new Kysely<Schema>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Run `fn` in a transaction whose tenant context is `tenantId`. The setting is transaction-local
 * (`is_local = true`), so it is gone when the connection returns to the pool.
 * Written with the query builder: `set_config` is an ordinary function call, no `sql` template needed.
 */
export function withTenant<Schema, T>(
  db: Kysely<Schema>,
  tenantId: string,
  fn: (tx: Transaction<Schema>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await tx
      .selectNoFrom((eb) => eb.fn<string>("set_config", [eb.val("app.tenant_id"), eb.val(tenantId), eb.lit(true)]).as("ctx"))
      .execute();
    return fn(tx);
  });
}
