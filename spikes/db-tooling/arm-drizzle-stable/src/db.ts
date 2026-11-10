import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

// Deliberately not PGHOST/PGPORT: a shell profile on this machine points those at a different local server.
export const HOST = process.env.SPIKE_DB_HOST ?? 'localhost';
export const PORT = Number(process.env.SPIKE_DB_PORT ?? 55432);

export const ROLES = {
  postgres: { user: 'postgres', password: 'postgres' },
  migrator: { user: 'skal_migrator', password: 'migrator' },
  app: { user: 'skal_app', password: 'app' },
} as const;

export type Role = keyof typeof ROLES;

export function url(database: string, role: Role = 'app'): string {
  const { user, password } = ROLES[role];
  return `postgres://${user}:${password}@${HOST}:${PORT}/${database}`;
}

export function pool(database: string, role: Role = 'app', max = 10): pg.Pool {
  return new pg.Pool({ connectionString: url(database, role), max });
}

export function connect(database: string, role: Role = 'app', max = 10): NodePgDatabase & { $client: pg.Pool } {
  return drizzle({ client: pool(database, role, max) });
}

// The transaction handle type, whatever schema a caller uses.
export type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/**
 * Run `fn` in a transaction whose tenant context is `tenantId` (or none, if null).
 * set_config(..., true) is transaction-local, so the setting cannot leak to the next borrower of the pooled
 * connection, and RLS sees nothing when no tenant is set.
 */
export function withTenant<T>(db: NodePgDatabase, tenantId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (tenantId !== null) await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
