/**
 * Opakovat se musí podle TVARU odpovědi, ne podle stavového kódu (CLASS gate)
 *
 * TŘÍDA VADY: služba odpoví stavem úspěchu a tělem, které na položenou otázku
 * vůbec neodpovídá. Vrstva, která opakuje podle kódu, nemá co opakovat —
 * z jejího pohledu se povedlo.
 *
 * Naměřeno 2026-08-26, dvakrát v jednom dni:
 *   · Coolify vrátil `HTTP 200` a v těle SVOU HTML stránku
 *     (`<!DOCTYPE html><html data-theme="dark" lang="en">`).
 *   · `curl --retry-all-errors` to neopakoval — požadavek uspěl.
 *   · Teprve kontrola o vrstvu výš zjistila, že to není JSON, a to už byl
 *     tvrdý FAIL, který přerušil celý cold-start.
 *
 * INVARIANT — dva různé nezdary si žádají OPAČNÉ chování:
 *   1. tělo, které NENÍ JSON  → služba na tuhle otázku neodpověděla;
 *      přechodné, OPAKOVAT;
 *   2. platný JSON, který není úspěch → API odpovědělo a odmítlo;
 *      opakování by jen zdrželo, VRÁTIT HNED.
 * Bez rozlišení je jedno z toho vždy špatně: buď se zahazuje běh kvůli
 * přechodné vadě, nebo se pětkrát opakuje odmítnutí.
 *
 * Měří se SKUTEČNÉ funkce z scripts/coolify-sync-envs.sh — vyříznou se ze
 * souboru, ne opíší. Kopie by časem přestala měřit to, co se spouští.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SKRIPT = join(ROOT, "scripts", "coolify-sync-envs.sh");

/** Vyřízne definice funkcí ze skutečného skriptu (od `od` po řádek před `do`). */
function vyrizniFunkce(od: string, doRadku: string): string {
  const radky = readFileSync(SKRIPT, "utf-8").split("\n");
  const i = radky.findIndex((l) => l.startsWith(od));
  const j = radky.findIndex((l, n) => n > i && l.startsWith(doRadku));
  expect(i, `${od} musí ve skriptu být`).toBeGreaterThan(-1);
  expect(j, `${doRadku} musí ve skriptu být`).toBeGreaterThan(i);
  return radky.slice(i, j).join("\n");
}

/**
 * Spustí API_BULK proti podvržené odpovědi.
 * @returns {rc, pokusu} — návratový kód a KOLIKRÁT se na službu sáhlo
 */
function spust(telo: string, retries = 3): { rc: number; pokusu: number } {
  const kod = [
    "set -u",
    "Y=''; N=''",
    vyrizniFunkce("bulk_response_ok()", "bulk_response_error()"),
    // Podvržená služba: počítá sáhnutí do souboru, vrací zadané tělo.
    'API() { echo x >> "$POCITADLO"; printf "%s" "$TELO"; }',
    // Bez čekání — měří se POČET pokusů, ne trpělivost.
    "sleep() { :; }",
    'API_BULK "$TELO" "http://test/envs/bulk" >/dev/null 2>&1; echo "rc=$?"',
    'echo "pokusu=$(wc -l < "$POCITADLO" | tr -d " ")"',
  ].join("\n");
  const pocitadlo = join(
    process.env.TMPDIR || execFileSync("bash", ["-c", "printf %s \"$(dirname $(mktemp -u))\""]).toString(),
    `bulk-pocitadlo-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  execFileSync("bash", ["-c", `: > "${pocitadlo}"`]);
  const out = execFileSync("bash", ["-c", kod], {
    env: { ...process.env, TELO: telo, POCITADLO: pocitadlo, COOLIFY_BULK_RETRIES: String(retries) },
    encoding: "utf-8",
  });
  return {
    rc: Number(/rc=(\d+)/.exec(out)?.[1]),
    pokusu: Number(/pokusu=(\d+)/.exec(out)?.[1]),
  };
}

describe("opakuje se podle tvaru odpovědi, ne podle stavového kódu", () => {
  test("úspěšný tvar projde napoprvé", () => {
    const r = spust('[{"uuid":"abc","key":"K"}]');
    expect(r.rc).toBe(0);
    expect(r.pokusu, "úspěch se neopakuje").toBe(1);
  });

  test("HTML se stavem úspěchu se OPAKUJE — přesně to shodilo cold-start", () => {
    const r = spust('<!DOCTYPE html><html data-theme="dark" lang="en"><script>', 3);
    expect(r.rc, "po vyčerpání pokusů se to musí ohlásit jako nezdar").toBe(1);
    expect(
      r.pokusu,
      "tělo, které není JSON, znamená že služba na tuhle otázku neodpověděla — " +
        "musí se to zkusit znovu, protože curl na stavu 200 nic neopakuje",
    ).toBe(3);
  });

  test("platná chyba API se NEOPAKUJE", () => {
    const r = spust('{"message":"The given data was invalid."}');
    expect(r.rc).toBe(1);
    expect(
      r.pokusu,
      "API odpovědělo a odmítlo; opakovat odmítnutí jen zdrží a zamlží příčinu",
    ).toBe(1);
  });

  test("prázdné tělo se taky opakuje (není JSON)", () => {
    const r = spust("", 2);
    expect(r.rc).toBe(1);
    expect(r.pokusu).toBe(2);
  });
});
