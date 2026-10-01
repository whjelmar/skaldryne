import { createDb, withTenant } from "../src/db.ts";
const { db, close } = createDb("postgresql://skal_app:app@localhost:55432/prisma_main");
try {
  const mig = createDb("postgresql://skal_migrator:migrator@localhost:55432/prisma_main");
  const [{ id }] = await mig.db.orm.public.Tenant.select("id").all() as any;
  await mig.close();
  console.log("no tenant entities", (await db.orm.public.Entity.all()).length);
  const ents = await withTenant(db, id, (tx) => tx.orm.public.Entity.select("id", "displayName", "custom").all());
  console.log("tenant entities", ents);
  const cur = await withTenant(db, id, (tx) => tx.orm.public.ClaimCurrent.all());
  console.log("claim_current", cur);
} catch (e) { console.log("ERR", (e as Error).message, (e as any).code); }
await close();
