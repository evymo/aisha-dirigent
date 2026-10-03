/**
 * Brána: sync env porovnává seznamy klíčů v BAJTOVÉ kolaci — locale terminálu
 * obsluhy nesmí vyrobit falešné MISSING.
 *
 * ⛔ NAMĚŘENO 2026-09-26 na skutečném .env.coolify (748 klíčů): validace
 * `coolify-sync-envs.sh` pod LC_ALL=en_US.UTF-8 hlásila 12 chybějících klíčů,
 * které v souboru BYLY (mj. POSTGRES_PASSWORD, APP_NAME_PREFIX); pod LC_ALL=C 0.
 * Nad jiným souborem (794 klíčů, všechny docker-compose.coolify*.yml): 14 MISSING
 * pod en_US.UTF-8, z toho 9 falešných; pod C 5 — a po opravě 5 pod oběma.
 *
 * MECHANISMUS: `comm` předpokládá, že oba vstupy jsou seřazené TOUŽ kolací,
 * jakou sám porovnává, a `sort` i `comm` ji berou z locale. Seznam povinných
 * proměnných ale řadí YAML extraktor v Node (`.sort()` = kódové body, bajtově),
 * kdežto `sort` pod en_US.UTF-8 staví `_` před písmena. Pořadí se rozejdou
 * a comm ztratí synchronizaci.
 *
 * CO SE MĚŘÍ (skutečné funkce vyříznuté ze skriptu, skutečný YAML extraktor):
 *   1. build_app_payload pod LC_ALL=en_US.UTF-8 nad klíči plnými podtržítek,
 *      které v souboru JSOU → 0 MISSING a všechny se doručí. Kontrolní vzorek:
 *      klíč, který v souboru opravdu NENÍ, se nahlásí — a jen on.
 *   2. Totéž pod EMULOVANOU jazykovou kolací. CI běží v node:20-bookworm, kde
 *      en_US.UTF-8 není: setlocale tam tiše spadne na C a bod 1 by zelenal,
 *      protože nic nevidí. Podvržený `sort` proto mimo C řadí `_` před písmena
 *      (jako en_US.UTF-8 na macOS) — a měřidlo se nejdřív ověří, že to umí.
 *   3. Třída: každé `comm`/`join` ve skriptech jede pod LC_ALL=C a v syncu vede
 *      jen přes klice_comm (jinak by NEW_KEYS v hlavní smyčce zůstalo mimo měření).
 *
 * Spouští se přes: npm run test:gates
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const SYNC = join(ROOT, "scripts/coolify-sync-envs.sh");
const LIB_APP_VARS = join(ROOT, "scripts/lib/coolify-app-vars.sh");
const LIB_BUILDTIME = join(ROOT, "scripts/lib/coolify-buildtime-envs.sh");
const JAZYKOVA = "en_US.UTF-8";

/** Klíče, na kterých se en_US.UTF-8 a C rozcházejí (podtržítko proti písmenu). */
const S_PODTRZITKY = ["POSTGRES_PASSWORD", "POSTGRES_MAJOR", "POSTGRESQL_X", "APP_NAME_PREFIX", "APPNAME"];
/** Další klíče souboru — instance jich má stovky, compose chce jen část. */
const JINE_V_SOUBORU = ["APP_X", "APPA", "COOLIFY_URL", "POSTGRES_DB", "ZZ_POSLEDNI"];

let pracovni: string;
let podvrzenySort: string;

beforeAll(() => {
  pracovni = mkdtempSync(join(tmpdir(), "sync-kolace-"));
  // Emulace jazykové kolace pro stroj, který en_US.UTF-8 nemá. Efektivní kolace
  // se určí jako v libc (LC_ALL > LC_COLLATE > LANG); C/POSIX jde rovnou na
  // skutečný sort, jinak `_` → bajt 0x01 (pod všemi písmeny), bajtové řazení,
  // a zpět. Stačí na volby, které skripty kolem syncu používají (`-u`).
  const skutecny = spawnSync("bash", ["-c", "command -v sort"], { encoding: "utf-8" }).stdout.trim();
  const shim = mkdtempSync(join(pracovni, "shim-"));
  podvrzenySort = shim;
  const cesta = join(shim, "sort");
  writeFileSync(
    cesta,
    [
      "#!/bin/bash",
      'kolace="${LC_ALL:-${LC_COLLATE:-${LANG:-}}}"',
      `case "$kolace" in ""|C|C.*|POSIX) exec "${skutecny}" "$@" ;; esac`,
      "volby=(); soubory=()",
      'for a in "$@"; do case "$a" in -*) volby+=("$a") ;; *) soubory+=("$a") ;; esac; done',
      `cat \${soubory[@]+"\${soubory[@]}"} | tr '_' '\\001' | LC_ALL=C "${skutecny}" \${volby[@]+"\${volby[@]}"} | tr '\\001' '_'`,
      "",
    ].join("\n"),
  );
  chmodSync(cesta, 0o755);
});

afterAll(() => {
  if (pracovni) rmSync(pracovni, { recursive: true, force: true });
});

type Vysledek = { req: number; missing: string[]; doruceno: string[]; stderr: string };

/**
 * Pustí SKUTEČNÉ `klice_comm` + `build_app_payload` ze sync skriptu nad
 * syntetickým compose (povinné `${X}` / `${X:?…}`) a souborem klíčů.
 */
function validuj(opts: { povinne: string[]; vSouboru: string[]; locale: string; emulace: boolean }): Vysledek {
  const scen = mkdtempSync(join(pracovni, "scen-"));
  const compose = [
    "services:",
    "  app:",
    "    image: busybox",
    "    environment:",
    ...opts.povinne.map((k, i) => `      V${i}: ${i % 2 ? `\${${k}:?povinná}` : `\${${k}}`}`),
    "",
  ].join("\n");
  writeFileSync(join(scen, "compose.yml"), compose);
  // Soubor klíčů v pořadí, v jakém ho drží .env.coolify — neseřazený.
  writeFileSync(join(scen, "klice"), [...opts.vSouboru].reverse().join("\n") + "\n");
  writeFileSync(
    join(scen, "payload.json"),
    JSON.stringify({ data: opts.vSouboru.map((key) => ({ key, value: "x" })) }),
  );
  const skript = String.raw`
    set -uo pipefail
    source "$LIB_BUILDTIME"
    source "$LIB_APP_VARS"
    eval "$(sed -n '/^klice_comm() {/,/^}/p' "$SYNC")"
    eval "$(sed -n '/^build_app_payload() {/,/^}/p' "$SYNC")"
    resolve_compose_for_app() { echo "compose.yml"; }
    resolve_slot_for_app() { return 1; }
    ROOT="$SCEN"
    ENV_KEYS_FILE="$SCEN/klice"
    BULK_PAYLOAD="$(cat "$SCEN/payload.json")"
    unset PKI_COLOCATED_SLOTS PKI_BRIDGE_URL_COLOCATED
    build_app_payload app 2>"$SCEN/err" | jq -r '.data[].key'
  `;
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    LIB_BUILDTIME,
    LIB_APP_VARS,
    SYNC,
    SCEN: scen,
    LC_ALL: opts.locale,
  };
  if (opts.emulace) env.PATH = `${podvrzenySort}:${process.env.PATH}`;
  const r = spawnSync("bash", ["-c", skript], { encoding: "utf-8", env });
  const err = readFileSync(join(scen, "err"), "utf-8");
  expect(r.status, `běh selhal:\n${r.stderr}\n${err}`).toBe(0);
  const radek = /^VALIDATION:req=(\d+) missing=(\d+)$/m.exec(err);
  expect(radek, `validace nevydala souhrn:\n${err}`).not.toBeNull();
  const missing = [...err.matchAll(/^\s+MISSING: (\S+)$/gm)].map((m) => m[1]).sort();
  expect(missing.length, "souhrn a výpis MISSING si odporují").toBe(Number(radek![2]));
  return {
    req: Number(radek![1]),
    missing,
    doruceno: r.stdout.split("\n").filter(Boolean).sort(),
    stderr: err,
  };
}

/** Pořadí, jak ho vydá `sort` pod daným locale (a volitelně s emulací). */
function seradSortem(klice: string[], locale: string, emulace: boolean): string[] {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), LC_ALL: locale };
  if (emulace) env.PATH = `${podvrzenySort}:${process.env.PATH}`;
  const r = spawnSync("sort", [], { input: klice.join("\n") + "\n", encoding: "utf-8", env });
  return r.stdout.split("\n").filter(Boolean);
}

const bajtove = (klice: string[]) => [...klice].sort();

describe("validace klíčů nezávisí na locale obsluhy", () => {
  test("měřidlo: emulovaná kolace řadí jinak než C (jinak by brána na CI nic neviděla)", () => {
    const emul = seradSortem(S_PODTRZITKY, JAZYKOVA, true);
    expect(emul, "emulace musí řadit `_` před písmena — jinak měří C proti C").not.toEqual(bajtove(S_PODTRZITKY));
    expect(seradSortem(S_PODTRZITKY, "C", true), "pod LC_ALL=C musí podvržený sort řadit bajtově").toEqual(
      bajtove(S_PODTRZITKY),
    );
  });

  for (const [nazev, emulace] of [
    [`skutečné ${JAZYKOVA}`, false],
    [`emulovaná jazyková kolace`, true],
  ] as const) {
    test(`${nazev}: klíče s podtržítky, které v souboru JSOU → 0 MISSING, všechny doručené`, () => {
      const r = validuj({
        povinne: S_PODTRZITKY,
        vSouboru: [...S_PODTRZITKY, ...JINE_V_SOUBORU],
        locale: JAZYKOVA,
        emulace,
      });
      expect(r.req).toBe(S_PODTRZITKY.length);
      expect(r.missing, `falešné MISSING — comm ztratil synchronizaci:\n${r.stderr}`).toEqual([]);
      expect(r.doruceno, "klíč, který compose chce a soubor má, se musí doručit").toEqual(bajtove(S_PODTRZITKY));
    });

    test(`${nazev}: kontrolní vzorek — klíč, který opravdu chybí, se nahlásí (a jen on)`, () => {
      const r = validuj({
        povinne: [...S_PODTRZITKY, "APP_NAME_CHYBI"],
        vSouboru: [...S_PODTRZITKY, ...JINE_V_SOUBORU],
        locale: JAZYKOVA,
        emulace,
      });
      expect(r.missing).toEqual(["APP_NAME_CHYBI"]);
      expect(r.doruceno).toEqual(bajtove(S_PODTRZITKY));
    });
  }
});

describe("třída: comm/join nad seznamy klíčů jen v bajtové kolaci", () => {
  const kod = (t: string) =>
    t
      .split("\n")
      .map((r, i) => [i + 1, r] as const)
      .filter(([, r]) => !/^\s*#/.test(r));
  /** Volání `comm`/`join` jako příkazu (ne zmínka, ne jq `join(…)`). */
  const VOLANI = /(^|[\s;&|(])(comm|join)\s+(-|<\(|"\$|\$)/;

  test("sync: každé comm vede přes klice_comm a klice_comm řadí i porovnává pod LC_ALL=C", () => {
    const text = readFileSync(SYNC, "utf-8");
    const telo = /^klice_comm\(\) \{\n([\s\S]*?)\n\}/m.exec(text);
    expect(telo, "klice_comm ve skriptu není").not.toBeNull();
    expect(telo![1]).toMatch(/LC_ALL=C comm /);
    const sorty = telo![1].match(/(\S+=\S+ )?sort\b/g) ?? [];
    expect(sorty.length, "klice_comm musí řadit obě strany sám").toBe(2);
    expect(sorty.every((s) => s.startsWith("LC_ALL=C ")), `řazení bez LC_ALL=C: ${sorty.join(", ")}`).toBe(true);
    const mimo = kod(text.replace(telo![0], ""))
      .filter(([, r]) => VOLANI.test(r))
      .map(([n, r]) => `${n}: ${r.trim()}`);
    expect(mimo, "comm/join mimo klice_comm porovná v kolaci volajícího").toEqual([]);
  });

  test("scripts/: žádné comm/join v kolaci volajícího", () => {
    const soubory: string[] = [];
    const chod = (d: string) => {
      for (const j of readdirSync(d)) {
        if (j === "node_modules" || j.startsWith(".")) continue;
        const p = join(d, j);
        if (statSync(p).isDirectory()) chod(p);
        else if (/\.(sh|bash)$/.test(j)) soubory.push(p);
      }
    };
    chod(join(ROOT, "scripts"));
    expect(soubory.length, "univerzum skriptů je prázdné — brána by nic neměřila").toBeGreaterThan(50);
    const nalezy = soubory.flatMap((p) =>
      kod(readFileSync(p, "utf-8"))
        .filter(([, r]) => VOLANI.test(r) && !/LC_ALL=C (comm|join)\s/.test(r))
        .map(([n, r]) => `${p.replace(`${ROOT}/`, "")}:${n}: ${r.trim()}`),
    );
    expect(nalezy, "comm/join porovnává kolací z locale — vstupy seřazené jinak se rozejdou").toEqual([]);
  });
});
