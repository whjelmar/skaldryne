// Idempotent import of entities with claims, keyed on import_record (tenant_id, source, source_key)
// and a content hash. Application code: query builder only.
import type { Kysely } from "kysely";
import { withTenant, type DB } from "./db/index.ts";

export interface ImportItem {
  sourceKey: string;
  kind: string;
  displayName: string;
  claims: { predicate: string; object: unknown }[];
}

export interface ImportStats {
  skipped: number;
  created: number;
  updated: number;
  claimVersions: number;
}

async function contentHash(item: ImportItem): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(item));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

export function importBatch(
  db: Kysely<DB>,
  tenantId: string,
  campaignId: string,
  source: string,
  items: ImportItem[],
): Promise<ImportStats> {
  return withTenant(db, tenantId, async (tx) => {
    const stats: ImportStats = { skipped: 0, created: 0, updated: 0, claimVersions: 0 };
    const existing = new Map(
      (
        await tx
          .selectFrom("import_record")
          .select(["source_key", "entity_id", "content_hash"])
          .where("source", "=", source)
          .where("source_key", "in", items.map((i) => i.sourceKey))
          .execute()
      ).map((r) => [r.source_key, r]),
    );

    for (const item of items) {
      const hash = await contentHash(item);
      const prior = existing.get(item.sourceKey);
      if (prior?.content_hash === hash) {
        stats.skipped++;
        continue;
      }

      let entityId: string;
      if (prior) {
        entityId = prior.entity_id;
        await tx.updateTable("entity").set({ kind: item.kind, display_name: item.displayName }).where("id", "=", entityId).execute();
        stats.updated++;
      } else {
        ({ id: entityId } = await tx
          .insertInto("entity")
          .values({ tenant_id: tenantId, campaign_id: campaignId, kind: item.kind, display_name: item.displayName })
          .returning("id")
          .executeTakeFirstOrThrow());
        stats.created++;
      }

      await tx
        .insertInto("import_record")
        .values({ tenant_id: tenantId, source, source_key: item.sourceKey, entity_id: entityId, content_hash: hash })
        .onConflict((oc) =>
          oc
            .columns(["tenant_id", "source", "source_key"])
            .doUpdateSet((eb) => ({ content_hash: eb.ref("excluded.content_hash"), imported_at: eb.ref("excluded.imported_at") }))
            .where("import_record.content_hash", "is distinct from", (eb) => eb.ref("excluded.content_hash")),
        )
        .execute();

      // One claim per (subject, predicate); a changed object appends a new version.
      const current = new Map(
        (
          await tx
            .selectFrom("claim_current")
            .select(["predicate", "claim_id", "version", "object"])
            .where("subject_id", "=", entityId)
            .execute()
        ).map((c) => [c.predicate, c]),
      );
      for (const claim of item.claims) {
        const cur = current.get(claim.predicate);
        if (cur && JSON.stringify(cur.object) === JSON.stringify(claim.object)) continue;
        await tx
          .insertInto("claim_version")
          .values({
            tenant_id: tenantId,
            claim_id: cur?.claim_id ?? crypto.randomUUID(),
            version: (cur?.version ?? 0) + 1,
            campaign_id: campaignId,
            subject_id: entityId,
            predicate: claim.predicate,
            object: JSON.stringify(claim.object),
          })
          .execute();
        stats.claimVersions++;
      }
    }
    return stats;
  });
}
