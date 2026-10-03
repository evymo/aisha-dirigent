/**
 * Brána: proměnná, kterou gateway čte ze svého prostředí, musí být v jejím bloku
 * v compose — jinak se do kontejneru NIKDY nedostane a kód za ní je tichý mrtvý kód.
 *
 * ⛔ PROČ (naměřeno na riq 2026-09-29, kolo 11): /auth/v1/device/enrol pouští ohlášení
 * tabletu jen za otevřenými dveřmi (`dvereOtevrene(KNOCK_UPSTREAM)`). Doktor klíč znal
 * (derived z topologie), edge i svc-knock ho měly — ale blok gatewaye v
 * docker-compose.coolify.yml ho neuváděl. Compose je jediná cesta do kontejneru
 * (žádný env_file), takže gateway dostala '' → enrol VŽDY 403 dvere_zavrene a žádný
 * tablet se v administraci neobjevil. Testy gateway to neviděly: routu testují
 * s injektovaným `dvere`, ne s prostředím kontejneru.
 *
 * Totéž platilo pro 50 dalších klíčů (volitelné funkce, adresy služeb…). Brána je
 * proto ROHATKA: dnešní dluh je v baseline a smí jen ubývat (vzor
 * cislo-z-prostredi-ma-straz). Nová čtená proměnná bez řádku v compose = ČERVENÁ.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "services/gateway/src");
const COMPOSE = join(ROOT, "docker-compose.coolify.yml");
const baseline = JSON.parse(
  readFileSync(join(__dirname, "gateway-env-v-compose.baseline.json"), "utf8"),
) as { klice: string[] };

function tsSoubory(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...tsSoubory(p));
    else if (e.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(e)) out.push(p);
  }
  return out;
}

/** Klíče, které gateway čte: process.env.X, process.env['X'], envValue('X'). */
export function ctene(zdroj: string): Set<string> {
  const k = new Set<string>();
  for (const re of [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\]/g,
    /envValue\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  ]) {
    for (const m of zdroj.matchAll(re)) k.add(m[1]);
  }
  return k;
}

/** Klíče z `environment:` služby `gateway` (mapa i seznam `- KEY=`). */
export function deklarovane(compose: string, sluzba: string): Set<string> {
  const radky = compose.split("\n");
  const start = radky.findIndex((r) => r === `  ${sluzba}:`);
  if (start < 0) throw new Error(`služba ${sluzba} v compose není`);
  const k = new Set<string>();
  for (let i = start + 1; i < radky.length; i++) {
    const r = radky[i];
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(r) || /^[A-Za-z]/.test(r)) break; // další služba / sekce
    const m = /^ {6}([A-Z][A-Z0-9_]*):/.exec(r) ?? /^ {6}- ([A-Z][A-Z0-9_]*)=/.exec(r);
    if (m) k.add(m[1]);
  }
  return k;
}

const soubory = tsSoubory(SRC);
const cteno = new Set<string>();
const kde = new Map<string, string>();
for (const f of soubory) {
  for (const k of ctene(readFileSync(f, "utf8"))) {
    cteno.add(k);
    if (!kde.has(k)) kde.set(k, relative(ROOT, f));
  }
}
const vCompose = deklarovane(readFileSync(COMPOSE, "utf8"), "gateway");
const chybi = [...cteno].filter((k) => !vCompose.has(k)).sort();

describe("gateway: co čte z prostředí, to má v compose", () => {
  it("měřidlo měří (kontrolní vzorek)", () => {
    expect(ctene("a = process.env.FOO_BAR; b = process.env['X_Y']; envValue('ZZ')")).toEqual(new Set(["FOO_BAR", "X_Y", "ZZ"]));
    const c = "services:\n  gateway:\n    environment:\n      A: x\n      - B=y\n  jina:\n    environment:\n      C: z\n";
    expect(deklarovane(c, "gateway")).toEqual(new Set(["A", "B"]));
    expect(cteno.size, "gateway nic nečte? měřidlo je slepé").toBeGreaterThan(20);
    expect(vCompose.size, "blok gatewaye v compose nenalezen").toBeGreaterThan(20);
  });

  it("⛔ zařízení: KNOCK_UPSTREAM a KNOCK_ROSTER_TOKEN gateway DOSTANE (enrol/roster)", () => {
    for (const k of ["KNOCK_UPSTREAM", "KNOCK_ROSTER_TOKEN"]) {
      expect(vCompose.has(k), `${k} chybí v bloku gatewaye — enrol/roster zařízení by byl mrtvý`).toBe(true);
    }
  });

  it("⛔ nová čtená proměnná bez řádku v compose nesmí PŘIBÝT", () => {
    const nove = chybi.filter((k) => !baseline.klice.includes(k)).map((k) => `${k} (${kde.get(k)})`);
    expect(nove, "přidej `KLIC: ${KLIC:-}` do bloku gateway v docker-compose.coolify.yml").toEqual([]);
  });

  it("⛔ rohatka je oboustranná: co už compose má (nebo gateway nečte), musí zmizet z baseline", () => {
    const splaceno = baseline.klice.filter((k) => !chybi.includes(k));
    expect(splaceno, "smaž je z gateway-env-v-compose.baseline.json").toEqual([]);
  });
});
