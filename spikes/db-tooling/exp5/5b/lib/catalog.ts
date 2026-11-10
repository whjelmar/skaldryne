// The fixed catalog query used by C2 (and for the "C4 changed nothing" check): one text line per fact about
// columns, types, nullability, defaults, keys, indexes, checks, RLS flags and policies in schema public.
// Partitions (relispartition) and objects Drizzle cannot describe (triggers, functions, grants) are left out.
import type pg from "pg";

export const CATALOG_SQL = String.raw`
WITH rel AS (
  SELECT c.oid, c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
)
SELECT 'table ' || relname || ' rls=' || relrowsecurity AS fact FROM rel
UNION ALL
SELECT 'column ' || r.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
       || (CASE WHEN a.attnotnull THEN ' not null' ELSE ' null' END)
       || ' default ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
FROM rel r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
UNION ALL
SELECT 'constraint ' || r.relname || ' ' || co.conname || ' ' || pg_get_constraintdef(co.oid)
FROM rel r JOIN pg_constraint co ON co.conrelid = r.oid AND co.conparentid = 0
UNION ALL
SELECT 'index ' || r.relname || ' ' || regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX (\S+) ON (public\.)?', 'CREATE \1INDEX \2 ON ')
FROM rel r JOIN pg_index i ON i.indrelid = r.oid
WHERE NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p','u'))
UNION ALL
SELECT 'policy ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || cmd || ' roles=' || roles::text
       || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
FROM pg_policies WHERE schemaname = 'public'
ORDER BY 1`;

export async function catalogSnapshot(c: pg.Client): Promise<string[]> {
  const { rows } = await c.query<{ fact: string }>(CATALOG_SQL);
  return rows.map((r) => r.fact);
}

/** Lines present on only one side, prefixed with '<' (left only) or '>' (right only). */
export function lineDiff(left: string[], right: string[]): string[] {
  const l = new Set(left);
  const r = new Set(right);
  return [...left.filter((x) => !r.has(x)).map((x) => `< ${x}`), ...right.filter((x) => !l.has(x)).map((x) => `> ${x}`)];
}
