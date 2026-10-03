/**
 * Brána: co služba importuje, to musí být i v BĚHOVÉM obrazu.
 *
 * ⛔ NAMĚŘENO 2026-08-31 — výpadek celého core stacku, hledaný čtyři hodiny.
 *
 * `svc-web-artifact` začala importovat `@aisha/web-canvas`. Stavěcí stupeň
 * balíček postavil, `verify-runtime-deps` prošel (běží TAMTÉŽ, kde balíček
 * existuje), obraz se sestavil, nasazení bylo zelené. Jenže běhový stupeň
 * kopíruje jen VYJMENOVANÉ `packages/*`, a na tenhle se zapomnělo — symlink
 * v node_modules tedy mířil do prázdna a kontejner se zacyklil na
 * ERR_MODULE_NOT_FOUND.
 *
 * A protože Coolify po několika restartech vyhodnotí `RestartLimitReached`
 * a zavolá `StopApplication` (tedy `compose down` CELÉ aplikace), neprojevilo
 * se to jako vada jedné služby, ale jako mizející stack: API 502, web bez
 * obsahu, kontejnery „záhadně" pryč. Příznak byl o čtyři vrstvy dál než
 * příčina a nic v repu na ni neukazovalo.
 *
 * Brána porovná dvě věci, které se dnes rozešly:
 *   · které `@aisha/*` balíčky služba IMPORTUJE ve svých zdrojích,
 *   · které se v jejím Dockerfilu kopírují do BĚHOVÉHO stupně.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SERVICES = path.join(ROOT, "services");

/** `@aisha/*` balíčky importované ve zdrojích služby (bez podcest a testů). */
function importovane(dirSluzby: string): string[] {
  const src = path.join(dirSluzby, "src");
  if (!fs.existsSync(src)) return [];
  const nalezene = new Set<string>();
  const projdi = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) projdi(p);
      else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) {
        for (const m of fs.readFileSync(p, "utf8").matchAll(/from\s+["']@aisha\/([a-z0-9-]+)/g)) {
          nalezene.add(m[1]);
        }
      }
    }
  };
  projdi(src);
  return [...nalezene].sort();
}

/**
 * Balíčky kopírované do BĚHOVÉHO stupně. Za běhový se považuje všechno za
 * POSLEDNÍM `FROM` — přesně to, co skončí ve výsledném obrazu.
 */
function vBehovemStupni(dockerfile: string): Set<string> {
  const text = fs.readFileSync(dockerfile, "utf8");
  const posledniFrom = text.lastIndexOf("\nFROM ");
  const behovy = posledniFrom === -1 ? text : text.slice(posledniFrom);
  const out = new Set<string>();
  for (const m of behovy.matchAll(/COPY\s+--from=\S+\s+\S*\/packages\/([a-z0-9-]+)/g)) out.add(m[1]);
  return out;
}

/**
 * Dockerfile služby. Bydlí na DVOU místech a brána musela hledat na obou:
 * `services/<jméno>/Dockerfile`, nebo kořenový `Dockerfile.*`, který službu
 * staví — ten se pozná podle toho, že kopíruje či spouští `services/<jméno>/dist`.
 *
 * ⛔ NAMĚŘENO 2026-08-31: první verze brány uměla jen první tvar, takže
 * `svc-web-render` (staví se z `Dockerfile.web-render` v kořeni) nekontrolovala
 * vůbec — a právě u něj jsem se pak spálil podruhé. Brána, která tiše přeskočí
 * část předmětu, je horší než žádná: tváří se, že prošlo něco, co se neměřilo.
 */
function najdiDockerfile(sluzba: string): string | null {
  const vlastni = path.join(SERVICES, sluzba, "Dockerfile");
  if (fs.existsSync(vlastni)) return vlastni;
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.startsWith("Dockerfile")) continue;
    const cesta = path.join(ROOT, f);
    if (!fs.statSync(cesta).isFile()) continue;
    if (new RegExp(`services/${sluzba}/dist`).test(fs.readFileSync(cesta, "utf8"))) return cesta;
  }
  return null;
}

const sluzby = fs
  .readdirSync(SERVICES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && najdiDockerfile(e.name) !== null)
  .map((e) => e.name);

describe("běhový obraz nese balíčky, které služba importuje", () => {
  it("sonda vidí služby (mlčení je samo nálezem)", () => {
    // Kdyby se změnilo rozložení repa, testy níž by prošly nad prázdnem.
    expect(sluzby.length).toBeGreaterThan(0);
  });

  for (const s of sluzby) {
    const dir = path.join(SERVICES, s);
    const potreba = importovane(dir);
    if (potreba.length === 0) continue;

    it(`${s}: každý importovaný @aisha/* je v běhovém stupni`, () => {
      const ma = vBehovemStupni(najdiDockerfile(s)!);
      const chybi = potreba.filter((b) => !ma.has(b));
      expect(
        chybi,
        `Služba ${s} importuje @aisha/${chybi.join(", @aisha/")}, ale jejich ` +
          `packages/ adresář se do BĚHOVÉHO stupně Dockerfilu nekopíruje. ` +
          `Obraz se sestaví a nasazení bude zelené — kontejner se pak zacyklí ` +
          `na ERR_MODULE_NOT_FOUND a Coolify po dosažení limitu restartů zastaví ` +
          `CELOU aplikaci. Náprava: přidat za poslední FROM řádek ` +
          `\`COPY --from=build /app/packages/<jméno> packages/<jméno>\`.`,
      ).toEqual([]);
    });
  }
});
