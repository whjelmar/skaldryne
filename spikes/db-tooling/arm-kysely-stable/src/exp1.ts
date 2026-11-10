// Experiment 1: the four hard queries, written with Kysely's query builder as far as it reasonably goes.
// Each Q1-Q3 function takes the tenant to filter on and, optionally, the tenant context to set (they differ only in the RLS check).
// Raw `sql` fragments are marked "RAW:" with the reason; scripts/exp1-metrics.ts counts them.
import { sql, type Kysely, type Transaction } from "kysely";
import { withTenant } from "./db/index.ts";
import type { DB } from "./db/types-exp1.ts";

type Tx = Transaction<DB>;

// BEGIN Q1
export function graphHops(db: Kysely<DB>, tenantId: string, startId: string, ctx = tenantId) {
  return withTenant(db, ctx, (tx) =>
    tx
      .withRecursive("walk(entity_id, depth, path)", (qb) =>
        qb
          .selectFrom("claim_current as c")
          .select([
            "c.subject_id as entity_id",
            sql<number>`1`.as("depth"), // RAW: literal column with a type; no builder for a bare constant select item
            sql<string[]>`array[(c.object ->> 'entity')::uuid, c.subject_id]`.as("path"), // RAW: ARRAY[] constructor
          ])
          .where("c.tenant_id", "=", tenantId)
          .where("c.object", "?", sql.lit("entity")) // RAW: literal operand so the partial index predicate matches
          .where(sql<string>`c.object ->> 'entity'`, "=", startId) // RAW: codegen types jsonb as a union incl. primitives, so .key() on the ref is typed never
          .where("c.subject_id", "<>", startId)
          .unionAll((qb2) =>
            qb2
              .selectFrom("walk as w")
              .innerJoin("claim_current as c", (join) =>
                join
                  .on("c.tenant_id", "=", tenantId)
                  .on("c.object", "?", sql.lit("entity")) // RAW: literal operand, as above
                  .on(sql<string>`c.object ->> 'entity'`, "=", sql<string>`w.entity_id::text`), // RAW: same ->> reason; uuid::text cast of a CTE column
              )
              .select([
                "c.subject_id as entity_id",
                sql<number>`w.depth + 1`.as("depth"), // RAW: arithmetic on a CTE column typed any
                sql<string[]>`w.path || c.subject_id`.as("path"), // RAW: array concatenation
              ])
              .where("w.depth", "<", 3)
              .where(sql<boolean>`c.subject_id <> all (w.path)`), // RAW: <> ALL(array)
          ),
      )
      .selectFrom(
        (eb) =>
          eb
            .selectFrom("walk as w")
            .innerJoin("entity as e", (join) => join.on("e.tenant_id", "=", tenantId).onRef("e.id", "=", "w.entity_id"))
            .select(["w.entity_id as entityId", "e.display_name as displayName", "w.depth", "w.path"])
            .distinctOn("w.entity_id")
            .orderBy("w.entity_id")
            .orderBy("w.depth")
            .as("shortest"),
      )
      .selectAll()
      .orderBy("depth")
      .orderBy("displayName")
      .execute(),
  );
}
// END Q1

// BEGIN Q2
export function searchSegments(db: Kysely<DB>, tenantId: string, campaignId: string, config: string, query: string, ctx = tenantId) {
  return withTenant(db, ctx, (tx) =>
    tx
      .selectFrom("transcript_segment as s")
      .innerJoin(
        sql<{ q: string }>`websearch_to_tsquery(${config}::regconfig, ${query})`.as("q"), // RAW: set-returning/scalar function in FROM with a parameterised regconfig
        (join) => join.onTrue(),
      )
      .select((eb) => [
        "s.id",
        "s.session_no as sessionNo",
        "s.start_ms as startMs",
        eb.cast<number>(eb.fn("round", [eb.cast(eb.fn("ts_rank_cd", ["s.tsv", "q.q"]), "numeric"), eb.lit(4)]), "float8").as("rank"),
        eb.fn<string>("ts_headline", [eb.cast(eb.val(config), sql`regconfig`), "s.text", "q.q"]).as("headline"),
      ])
      .where("s.tenant_id", "=", tenantId)
      .where("s.campaign_id", "=", campaignId)
      .where((eb) => eb("s.tsv", "@@", eb.ref("q.q")))
      .orderBy("rank", "desc")
      .orderBy("s.session_no")
      .orderBy("s.start_ms")
      .limit(10)
      .execute(),
  );
}
// END Q2

// BEGIN Q3
export function hybridSearch(
  db: Kysely<DB>,
  tenantId: string,
  campaignId: string,
  config: string,
  query: string,
  queryVector: number[],
  ctx = tenantId,
) {
  const qv = `[${queryVector.join(",")}]`;
  return withTenant(db, ctx, (tx) =>
    tx
      .with("fts", (qb) =>
        qb
          .selectFrom("transcript_segment as s")
          .innerJoin(
            sql<{ q: string }>`websearch_to_tsquery(${config}::regconfig, ${query})`.as("q"), // RAW: function in FROM, as in Q2
            (join) => join.onTrue(),
          )
          .select((eb) => [
            "s.id",
            eb
              .cast<number>(
                eb.fn.agg("row_number").over((ob) => ob.orderBy(eb.fn("ts_rank_cd", ["s.tsv", "q.q"]), "desc").orderBy("s.id")),
                "integer",
              )
              .as("r"),
          ])
          .where("s.tenant_id", "=", tenantId)
          .where("s.campaign_id", "=", campaignId)
          .where((eb) => eb("s.tsv", "@@", eb.ref("q.q")))
          .orderBy("r")
          .limit(10),
      )
      .with("vec", (qb) =>
        qb
          .selectFrom("segment_embedding as e")
          .innerJoin("transcript_segment as s", (join) => join.onRef("s.tenant_id", "=", "e.tenant_id").onRef("s.id", "=", "e.segment_id"))
          .select((eb) => [
            "e.segment_id as id",
            eb
              .cast<number>(
                eb.fn.agg("row_number").over((ob) => ob.orderBy(sql`e.embedding <=> ${qv}::halfvec(768)`).orderBy("e.segment_id")), // RAW: pgvector <=> operator and halfvec cast
                "integer",
              )
              .as("r"),
          ])
          .where("s.tenant_id", "=", tenantId)
          .where("s.campaign_id", "=", campaignId)
          .orderBy("r")
          .limit(10),
      )
      .selectFrom("fts as f")
      .fullJoin("vec as v", "v.id", "f.id")
      .select((eb) => [
        eb.fn.coalesce("f.id", "v.id").as("id"),
        "f.r as ftsRank",
        "v.r as vecRank",
        sql<number>`round(coalesce(1.0 / (60 + f.r), 0) + coalesce(1.0 / (60 + v.r), 0), 6)::float8`.as("score"), // RAW: numeric arithmetic with nullable operands from a FULL JOIN
      ])
      .orderBy("score", "desc")
      .orderBy("id")
      .limit(10)
      .execute(),
  );
}
// END Q3

// BEGIN Q4A
export function claimJobs(tx: Tx, worker: string, n: number) {
  return tx
    .updateTable("job")
    .set((eb) => ({
      state: "running",
      locked_by: worker,
      locked_at: eb.fn<Date>("now", []),
      attempts: eb("attempts", "+", 1),
    }))
    .where((eb) => {
      const ready = eb
        .selectFrom("job")
        .select(["tenant_id", "id"])
        .where("state", "=", "queued")
        .where("run_after", "<=", eb.fn<Date>("now", []))
        .orderBy("run_after")
        .orderBy("id")
        .limit(n)
        .forUpdate()
        .skipLocked();
      return sql<boolean>`(tenant_id, id) in (${ready})`; // RAW: row-value IN (subquery); Kysely types a tuple IN as a one-column subquery
    })
    .returning(["id", "kind", "payload", "attempts"])
    .execute();
}
// END Q4A

// BEGIN Q4B
export function completeJob(tx: Tx, id: string, worker: string) {
  return tx
    .updateTable("job")
    .set({ state: "done", locked_by: null, locked_at: null })
    .where("id", "=", id)
    .where("locked_by", "=", worker)
    .returning(["id", "state"])
    .execute();
}
// END Q4B

// BEGIN Q4C
export function retryJob(tx: Tx, id: string, worker: string) {
  return tx
    .updateTable("job")
    .set((eb) => ({
      state: eb.case().when("attempts", ">=", 3).then("failed").else("queued").end(),
      run_after: sql<Date>`now() + make_interval(secs => 30 * attempts)`, // RAW: make_interval named argument (secs =>) is not expressible through eb.fn
      locked_by: null,
      locked_at: null,
    }))
    .where("id", "=", id)
    .where("locked_by", "=", worker)
    .returning(["id", "state", "attempts"])
    .execute();
}
// END Q4C
