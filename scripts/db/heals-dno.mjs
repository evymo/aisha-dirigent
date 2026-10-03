#!/usr/bin/env node
/**
 * heals-dno.mjs — změří DNO pro bránu heals-definice-pred-pouzitim: objekty,
 * které měla baseline nejstarší podporované databáze.
 *
 * Dno se neodhaduje. Zapisuje se revize, ze které pochází, a DŮKAZ, proč právě
 * ona (co živá DB měla a co už ne). Brána pak jede offline — CI klon nemusí
 * mít historii, ze které se dno měřilo.
 *
 * Použití:
 *   node scripts/db/heals-dno.mjs <revize> "<důkaz>" > src/tests/gates/heals-definice-pred-pouzitim.dno.json
 */
import { execFileSync } from "node:child_process";
import { objektySql } from "../lib/heals-definice-pred-pouzitim.mjs";

const [rev, dukaz] = process.argv.slice(2);
if (!rev || !dukaz) {
  console.error('použití: heals-dno.mjs <revize> "<důkaz, proč je tohle nejstarší podporovaná DB>"');
  process.exit(2);
}
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
const commit = git("rev-parse", "--short=9", rev);
const datum = git("log", "-1", "--format=%ad", "--date=short", commit);
const baseline = git("show", `${commit}:aisha/db/migrations/00000000000000_baseline.sql`);
// Objekt na řádek: změna dna je pak v diffu čitelná po jménech.
process.stdout.write(JSON.stringify({ commit, datum, dukaz, objekty: objektySql(baseline) }, null, 1) + "\n");
