/**
 * Kdo čte env soubor (.env.coolify, .env-prod-backup) jinak než `source`, dostane
 * hodnotu STEJNĚ jako bash — ne odříznuté uvozovky se zbytky escapů.
 *
 * ⛔ NAMĚŘENO 2026-09-19 (guru): env-doktor uvozuje hodnoty, které by `source`
 * rozbil (`"{\"email\":…}"`, lib/env-hodnota.mjs). coolify-sync-envs,
 * coolify-deploy-init a config-env-files.parseEnvFile uvozovky jen ODŘÍZLY —
 * `AISHA_OPERATORS` šel do Coolify jako `{\"email\":…}`, migrace hlásila
 * „AISHA_OPERATORS is not valid JSON" a operátoři se NIKDY neprovisionovali
 * (guru6 i guru8).
 *
 * ⭐ Co brána drží:
 *   1. cesty, kterými hodnoty jdou do Coolify, čtou sdíleným dekodérem
 *      (shell: lib/env-soubor.sh; node: parseEnvFile → odUvozovkuj);
 *   2. RÁČNA: naivní odříznutí uvozovek (`.replace(/^["']|["']$/g, "")`, `sed
 *      "s/^['\"]//"`) smí jen ubývat. Stávající výskyty čtou klíče, které env-doktor
 *      neuvozuje (tokeny, adresy) — nový kód ale musí jít přes dekodér.
 * Že dekodéry vrací totéž co bash, měří scripts/lib/env-soubor.test.mjs.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Stav 2026-09-19 po opravě cest do Coolify. Smí jen klesat. */
const RACNA_MJS = 60;
// aisha-cold-start-env.sh read_backup_key: čte jen COOLIFY_* adresy a UUID (bez zvláštních znaků).
const RACNA_SH = 1;

const NAIVNI_MJS = /replace\(\/\^\["']\|\["']\$\/g,\s*""\)/g;
const NAIVNI_SH = /s\/\^\[(?:'\\?"|\\?"'|'\\''\\"|'\\"')\]\/\//g;

function soubory(adresar: string, pripona: RegExp, out: string[] = []): string[] {
  for (const jmeno of readdirSync(adresar)) {
    if (jmeno === "node_modules") continue;
    const cesta = join(adresar, jmeno);
    if (statSync(cesta).isDirectory()) soubory(cesta, pripona, out);
    else if (pripona.test(jmeno) && !/\.test\./.test(jmeno)) out.push(relative(ROOT, cesta));
  }
  return out;
}

const pocet = (re: RegExp, seznam: string[]) =>
  seznam.map((s) => ({ s, n: [...cti(s).matchAll(re)].length })).filter((x) => x.n > 0);

describe("env soubor se čte jako bash (brána)", () => {
  test("⛔ cesty do Coolify čtou sdíleným dekodérem", () => {
    const sync = cti("scripts/coolify-sync-envs.sh");
    const init = cti("scripts/coolify-deploy-init.sh");
    const coldStart = cti("scripts/aisha-cold-start.sh");
    const parser = cti("scripts/lib/config-env-files.mjs");
    expect(sync).toMatch(/lib\/env-soubor\.sh/);
    expect(sync, "sync nesmí mít vlastní parser").not.toMatch(/^\s*parse_env_file\(\)\s*\{\s*\n\s*awk/m);
    expect(init).toMatch(/lib\/env-soubor\.sh/);
    expect(init).toMatch(/parse_env_soubor/);
    expect(parser).toMatch(/odUvozovkuj\(/);
    expect(coldStart).toMatch(/lib\/env-soubor\.sh/);
    expect(coldStart, "cold-start nesmí mít vlastní read_env_key").not.toMatch(/^read_env_key\(\)\s*\{/m);
  });

  test("⛔ ráčna: naivní odříznutí uvozovek jen ubývá", () => {
    const mjs = pocet(NAIVNI_MJS, soubory(join(ROOT, "scripts"), /\.mjs$/));
    const sh = pocet(NAIVNI_SH, soubory(join(ROOT, "scripts"), /\.sh$/));
    const celkemMjs = mjs.reduce((a, x) => a + x.n, 0);
    const celkemSh = sh.reduce((a, x) => a + x.n, 0);
    expect(celkemMjs, "univerzum: měřidlo přestalo vidět stávající výskyty").toBeGreaterThan(0);
    const zprava = (typ: string, seznam: typeof mjs) =>
      `${typ}: přibylo naivní odříznutí uvozovek — použij odUvozovkuj()/parseEnvFile (node) nebo lib/env-soubor.sh (shell):\n` +
      seznam.map((x) => `  ${x.s} (${x.n})`).join("\n");
    expect(celkemMjs, zprava("mjs", mjs)).toBeLessThanOrEqual(RACNA_MJS);
    expect(celkemSh, zprava("sh", sh)).toBeLessThanOrEqual(RACNA_SH);
  });
});
