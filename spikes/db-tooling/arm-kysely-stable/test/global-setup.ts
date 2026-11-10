import { bootstrap } from "../scripts/bootstrap.ts";

// Clean state for every `pnpm test`: drop/recreate kysely14_main and kysely14_shadow, then apply
// M1..M3 with graphile-migrate.
export default async function setup(): Promise<void> {
  await bootstrap({ migrate: true });
}
