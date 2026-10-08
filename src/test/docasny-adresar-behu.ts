/**
 * Kořen dočasných adresářů CELÉHO běhu vitestu (`globalSetup`) — uklidí i to, co
 * úklid po souborech (`docasny-adresar-souboru.ts`) nestihne.
 *
 * ⛔ NAMĚŘENO 2026-10-03: s úklidem jen po souborech nechal `test:run` 149 adresářů
 * `aisha-testy-*` — přesně tolik, kolik je souborů se VŠEMI testy přeskočenými
 * (149 skipped). Vitest u takového souboru setupFiles spustí, hooky (`afterAll`) ne.
 *
 * Běží v hlavním procesu jednou za běh, dřív než vzniknou workery: nastaví
 * TMPDIR/TMP/TEMP na kořen běhu — workery skládají prostředí z `process.env`
 * hlavního procesu až při spuštění testů, takže adresáře souborů vznikají uvnitř —
 * a po posledním souboru kořen smaže i se vším, co v něm zůstalo.
 *
 * Reportéry hlavního procesu do dočasného adresáře nepíšou (AISHA_REPORT_DIR nebo
 * docs/db-structure, viz src/tests/helpers/reportPaths.ts), smazání je nepřipraví
 * o report. Po smazání se prostředí hlavního procesu vrátí, jak bylo.
 *
 * Hlídá brána `testy-uklidi-docasne-adresare`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PREDPONA_BEHU = "aisha-testy-beh-";
const PROMENNE = ["TMPDIR", "TMP", "TEMP"] as const;

export default function korenBehu(): () => void {
  const puvodni = new Map(PROMENNE.map((k) => [k, process.env[k]]));
  const adresar = mkdtempSync(join(tmpdir(), PREDPONA_BEHU));
  for (const k of PROMENNE) process.env[k] = adresar;
  return () => {
    rmSync(adresar, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    for (const [k, v] of puvodni) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
