// Builds a raw SQL migration operation in the shape the Prisma 8 planner emits.
// `check` is a query returning one boolean column named `result`: true once the change is in place.
// The precheck is its negation, so a re-run skips operations that already took effect.
import { rawSql } from "@prisma/orm-postgres/migration";

export function raw(id: string, label: string, statements: string[], check: string) {
  return rawSql({
    id,
    label,
    operationClass: "additive",
    target: { id: "postgres" },
    precheck: [{ description: `ensure not yet applied: ${label}`, sql: `SELECT NOT (${check.replace(/ AS result$/, "")}) AS result`, params: [] }],
    execute: statements.map((sql, i) => ({ description: `${label} (${i + 1}/${statements.length})`, sql, params: [] })),
    postcheck: [{ description: `verify: ${label}`, sql: check, params: [] }],
  } as Parameters<typeof rawSql>[0]);
}
