/**
 * Brána: zápis env souboru PŘEŽIJE SYMLINK.
 *
 * ⛔ NAMĚŘENO 2026-09-15. Redeploy spuštěný z git worktree, kde je
 * `.env.coolify` symlink na hlavní trezor, zapsal soubor přes
 * `tmp + renameSync(tmp, ENV_COOLIFY)`. Přejmenování na cestu symlinku ho
 * NAHRADÍ regulárním souborem: zápis skončil v kopii, hlavní trezor zůstal
 * bez MESH_PEER_IPS a s 4 položkami GATEWAY_TRUSTED_PROXIES místo 25 —
 * a trezor se tiše rozštěpil. Týž vzor (`mv "$tmp" "$ENV_FILE"`) měly
 * i čtyři shellové zapisovače.
 *
 * CO SE MĚŘÍ:
 *   1. Žádný shellový skript nepřesouvá soubor na cestu env souboru holým `mv`
 *      — atomická náhrada jde přes `env_zapis_atomicky` (scripts/lib/env-zapis.sh).
 *   2. Žádný JS skript nepřejmenovává na cestu env souboru holým `renameSync`
 *      — jde přes `nahradObsahAtomicky` (scripts/lib/zapis-env-atomicky.mjs).
 *   3. Obě knihovny rozlišují skutečnou cestu (chování ověřuje
 *      scripts/lib/zapis-env-atomicky.test.mjs na skutečném symlinku).
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function soubory(pripona: RegExp): { cesta: string; radky: string[] }[] {
  const out: { cesta: string; radky: string[] }[] = [];
  const projdi = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f === "node_modules" || f === "dist" || f.startsWith(".")) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) projdi(p);
      else if (pripona.test(f) && !/\.test\.|\.spec\./.test(f)) {
        out.push({ cesta: relative(ROOT, p), radky: readFileSync(p, "utf-8").split("\n") });
      }
    }
  };
  projdi(join(ROOT, "scripts"));
  projdi(join(ROOT, "infra"));
  return out;
}

/** Cíl, který je env souborem: proměnná s ENV v názvu nebo literál .env.coolify / .env-prod-backup. */
const ENV_CIL = String.raw`(?:"?\$\{?[A-Z_]*ENV[A-Z_]*\}?"?|[^\s"']*\.env\.coolify"?|[^\s"']*\.env-prod-backup"?)`;

describe("zápis env souboru přežije symlink", () => {
  const sh = soubory(/\.sh$/);
  const js = soubory(/\.(mjs|js|ts)$/);

  test("univerzum není prázdné", () => {
    expect(sh.length).toBeGreaterThan(20);
    expect(js.length).toBeGreaterThan(20);
  });

  test("shell: žádné holé `mv … <env soubor>`", () => {
    const mvNaEnv = new RegExp(String.raw`\bmv\b(?:\s+-[a-zA-Z]+)*\s+\S+\s+${ENV_CIL}\s*(?:$|&&|;|\||\))`);
    const nalezy: string[] = [];
    for (const { cesta, radky } of sh) {
      if (cesta === "scripts/lib/env-zapis.sh") continue;
      radky.forEach((r, i) => {
        if (/^\s*#/.test(r)) return;
        if (mvNaEnv.test(r)) nalezy.push(`${cesta}:${i + 1}: ${r.trim()}`);
      });
    }
    expect(
      nalezy,
      "`mv` na cestu symlinku ho nahradí regulárním souborem a trezor se rozštěpí. " +
        "Použij `env_zapis_atomicky <zdroj> <cil>` ze scripts/lib/env-zapis.sh.",
    ).toEqual([]);
    // Sonda: detekce musí chytit tvary, které tu opravdu byly.
    expect(mvNaEnv.test('  mv "$tmp" "$ENV_FILE"')).toBe(true);
    expect(mvNaEnv.test('  mv "$TMP_ENV" "$ENV_COOLIFY"')).toBe(true);
    expect(mvNaEnv.test('&& mv "${ENV_COOLIFY}.pki-tmp" "$ENV_COOLIFY" && chmod 600 "$ENV_COOLIFY"')).toBe(true);
  });

  test("JS: žádné holé `renameSync(…, <env soubor>)`", () => {
    const renameNaEnv = /renameSync\([^,]+,\s*(?:ENV_[A-Z_]*|[a-zA-Z_]*[Ee]nv[A-Za-z_]*|["'`][^"'`]*\.env[^"'`]*["'`])\s*\)/;
    const nalezy: string[] = [];
    for (const { cesta, radky } of js) {
      if (cesta === "scripts/lib/zapis-env-atomicky.mjs") continue;
      radky.forEach((r, i) => {
        if (/^\s*(\/\/|\*)/.test(r)) return;
        if (renameNaEnv.test(r)) nalezy.push(`${cesta}:${i + 1}: ${r.trim()}`);
      });
    }
    expect(
      nalezy,
      "rename na cestu symlinku ho nahradí souborem. Použij nahradObsahAtomicky ze scripts/lib/zapis-env-atomicky.mjs.",
    ).toEqual([]);
    expect(renameNaEnv.test("    renameSync(_docasny, ENV_COOLIFY);")).toBe(true);
  });

  test("obě knihovny rozlišují skutečnou cestu a zapisují vedle ní", () => {
    const shLib = readFileSync(join(ROOT, "scripts/lib/env-zapis.sh"), "utf-8");
    expect(shLib).toMatch(/readlink/);
    expect(shLib).toMatch(/mktemp "\$\(dirname "\$realny"\)/);
    const jsLib = readFileSync(join(ROOT, "scripts/lib/zapis-env-atomicky.mjs"), "utf-8");
    expect(jsLib).toMatch(/realpathSync\(cesta\)/);
    expect(jsLib).toMatch(/renameSync\(docasny, cil\)/);
  });
});
