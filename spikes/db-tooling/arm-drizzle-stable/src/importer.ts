// Idempotent import keyed on import_record (tenant_id, source, source_key) and content_hash.
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { withTenant } from './db.ts';
import * as s from './schema/m3.ts';

export interface ImportItem {
  key: string;
  kind: string;
  displayName: string;
  claims: { predicate: string; object: unknown }[];
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** A stable UUID (version 8, name-based) from arbitrary parts, so re-imports address the same rows. */
async function stableUuid(...parts: string[]): Promise<string> {
  const b = (await sha256(parts.join('\u0000'))).slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x80;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Buffer.from(b).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface ImportStats {
  imported: number;
  unchanged: number;
  claimVersions: number;
}

export async function importBatch(
  db: NodePgDatabase,
  tenantId: string,
  campaignId: string,
  source: string,
  items: ImportItem[],
): Promise<ImportStats> {
  return withTenant(db, tenantId, async (tx) => {
    const stats: ImportStats = { imported: 0, unchanged: 0, claimVersions: 0 };
    for (const item of items) {
      const contentHash = Buffer.from(await sha256(JSON.stringify(item))).toString('hex');
      const entityId = await stableUuid(tenantId, source, item.key);

      await tx
        .insert(s.entity)
        .values({ tenantId, id: entityId, campaignId, kind: item.kind, displayName: item.displayName })
        .onConflictDoNothing({ target: [s.entity.tenantId, s.entity.id] });

      // Insert, or update only when the content changed. No row back means "already imported, same content".
      const changed = await tx
        .insert(s.importRecord)
        .values({ tenantId, source, sourceKey: item.key, entityId, contentHash })
        .onConflictDoUpdate({
          target: [s.importRecord.tenantId, s.importRecord.source, s.importRecord.sourceKey],
          set: { contentHash: sql`excluded.content_hash`, importedAt: sql`now()` },
          setWhere: sql`${s.importRecord.contentHash} is distinct from excluded.content_hash`,
        })
        .returning({ entityId: s.importRecord.entityId });
      if (changed.length === 0) {
        stats.unchanged++;
        continue;
      }
      stats.imported++;

      await tx
        .update(s.entity)
        .set({ kind: item.kind, displayName: item.displayName })
        .where(and(eq(s.entity.tenantId, tenantId), eq(s.entity.id, entityId)));

      for (const claim of item.claims) {
        const claimId = await stableUuid(tenantId, source, item.key, claim.predicate);
        const [current] = await tx
          .select({ version: s.claimCurrent.version, object: s.claimCurrent.object })
          .from(s.claimCurrent)
          .where(and(eq(s.claimCurrent.tenantId, tenantId), eq(s.claimCurrent.claimId, claimId)));
        if (current && JSON.stringify(current.object) === JSON.stringify(claim.object)) continue;
        await tx.insert(s.claimVersion).values({
          tenantId,
          claimId,
          version: (current?.version ?? 0) + 1,
          campaignId,
          subjectId: entityId,
          predicate: claim.predicate,
          object: claim.object,
        });
        stats.claimVersions++;
      }
    }
    return stats;
  });
}
