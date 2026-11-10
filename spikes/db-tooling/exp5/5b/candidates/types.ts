export interface Ctx {
  variantId: string;
  dir: string; // work/<variant>: schema/, migrations/, drizzle.config.ts
  db: string; // the migrated database (schema5_<variant>)
}
export interface Outcome {
  /** One line per difference the candidate reports. Empty means "schema matches database". */
  findings: string[];
  /** Candidate failed to run (crash, timeout), distinct from "found differences". */
  error?: string;
  /** Free-form facts for the report (exit codes, statement counts, whether the db was left unchanged). */
  facts?: Record<string, unknown>;
}
