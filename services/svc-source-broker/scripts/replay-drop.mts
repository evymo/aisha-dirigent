/**
 * replay-drop — jednorázový replay ingest balíků z dropu do databáze, MIMO scheduler.
 *
 *   AISHA_DB_URL=postgres://… npx tsx services/svc-source-broker/scripts/replay-drop.mts <drop-dir>
 *
 * ⛔ PROČ (2026-09-06). `ingestBundle` volal jen tick scheduleru běžící služby
 * (li-driver.ts ~ř. 1051). Ověřit balík z CRM exportu nad throwaway databází —
 * kolik dvojčat, vazeb, dokladů a událostí opravdu vznikne — tedy vyžadovalo
 * buď nasadit celý broker, nebo důvěřovat převodníku naslepo. Tohle je tenký
 * obal: tentýž driver, tatáž pravidla (verify fail-closed, service_role sezení),
 * jen bez smyčky a bez kurzoru v DB. Nic tu není nové — proto je to skript, ne
 * druhá implementace.
 *
 * Kurzor se NEPOSOUVÁ: replay je měření, ne produkční příjem. V produkci balíky
 * přijímá scheduler nad LOCAL_INGEST_DROP_DIR.
 */
import { Client } from 'pg';
import { discoverBundles, assertBundleTrusted, ingestBundle } from '../src/clients/li-driver.js';
import type { FastifyBaseLogger } from 'fastify';

const dropDir = process.argv[2];
const dbUrl = process.env.AISHA_DB_URL ?? process.env.DATABASE_URL;
if (!dropDir || !dbUrl) {
  console.error('použití: AISHA_DB_URL=postgres://… tsx replay-drop.mts <drop-dir>');
  process.exit(2);
}

// Logger ve tvaru, jaký driver očekává; hlášky jdou na stderr, výsledek na stdout.
const log = (level: string) => (obj: unknown, msg?: string) => {
  const line = typeof obj === 'string' ? obj : msg ?? '';
  const ctx = typeof obj === 'object' && obj ? JSON.stringify(obj) : '';
  console.error(`[${level}] ${line} ${ctx}`.trim());
};
const logger = { info: log('info'), warn: log('warn'), error: log('error'), debug: () => {}, trace: () => {}, fatal: log('fatal'), child: () => logger } as unknown as FastifyBaseLogger;

const pg = new Client({ connectionString: dbUrl });
await pg.connect();
try {
  // Stejně jako scheduler: sezení je service_role (RPC li_upsert_* / twin_* na tom stojí).
  await pg.query(`SET request.jwt.claims = '{"role":"service_role"}'`);
  await pg.query('SET ROLE service_role');
  const bundles = discoverBundles(dropDir);
  const out: Record<string, unknown>[] = [];
  for (const bundle of bundles) {
    assertBundleTrusted(bundle);
    const counts = await ingestBundle(pg, bundle, logger);
    out.push({ export_id: bundle.manifest.export_id, counts });
  }
  console.log(JSON.stringify({ bundles: bundles.length, results: out }, null, 2));
} finally {
  await pg.end();
}
