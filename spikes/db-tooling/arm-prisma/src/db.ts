// The runtime decodes timestamptz to Temporal.Instant and needs a global Temporal. Node 25 has none,
// and only the CLI loads temporal-polyfill for itself, so application code must install it (see RESULTS.md).
import "temporal-polyfill/global";
import postgres from "@prisma/orm-postgres/runtime";
import pgvector from "@prisma/orm-extension-pgvector/runtime";
import pg from "pg";
import type { Contract } from "../prisma/contract.d.ts";
import contractJson from "../prisma/contract.json" with { type: "json" };

// WORKAROUND (RC bug, see RESULTS.md): the runtime lets pg parse jsonb, then its jsonb codec runs
// JSON.parse again on any string it gets back. A jsonb string scalar such as "mayor" therefore fails
// with RUNTIME.DECODE_FAILED. Handing the codec the raw text makes it parse exactly once.
pg.types.setTypeParser(pg.types.builtins.JSONB, (v: string) => v);
pg.types.setTypeParser(pg.types.builtins.JSON, (v: string) => v);

/** Builds a client over a pool this module owns, so the pool size is ours to set. */
export function createDb(url: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 1 });
  const db = postgres<Contract>({ contractJson, pg: pool, extensions: [pgvector] });
  return { db, pool, async close() { await db.close(); await pool.end(); } };
}

export type Db = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// WORKAROUND (RC issue, see RESULTS.md): the default verifyMarker "onFirstUse" checks the database
// marker on a second pool connection. If the first use of a client is inside db.transaction on a pool
// of size 1, the transaction holds the only connection and the marker check waits for it forever
// (the session sits "idle in transaction" after BEGIN). One query outside a transaction first keeps
// the marker check and avoids the deadlock; concurrent callers share the same warm-up.
const warmedUp = new WeakMap<Db, Promise<unknown>>();
function warmUp(db: Db): Promise<unknown> {
  let p = warmedUp.get(db);
  if (!p) { p = db.orm.public.Tenant.first(); warmedUp.set(db, p); }
  return p;
}

/**
 * Runs fn in one transaction with app.tenant_id set for that transaction only
 * (set_config(..., true) is transaction-local, so the setting cannot leak to the next borrower).
 * The transaction context has no raw lane of its own, so the plan is built on db.raw and run on tx.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => PromiseLike<T>): Promise<T> {
  await warmUp(db);
  return db.transaction(async (tx) => {
    await tx.query(
      db.raw.sql`SELECT set_config('app.tenant_id', ${tenantId}, true) AS tenant`
        .returnsRow({ tenant: "pg/text@1" })
        .build(),
    );
    return fn(tx);
  });
}
