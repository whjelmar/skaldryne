// Expression canonicaliser shared by C1 and C3. Postgres deparses expressions (extra parentheses, ::text casts,
// IN (...) rewritten as = ANY (ARRAY[...])); Drizzle keeps the text as typed. Compare them after this.
export function canonExpr(s: string): string {
  let x = s.replace(/::text/g, "").replace(/::character varying/g, "").toLowerCase().replace(/\s+/g, "");
  x = x.replace(/=any\(array\[([^\]]*)\]\)/g, "in($1)");
  return x.replace(/[()]/g, "");
}

/** Sorted unique lines, for set-style comparison of findings. */
export const uniq = (xs: string[]) => [...new Set(xs)].sort();
