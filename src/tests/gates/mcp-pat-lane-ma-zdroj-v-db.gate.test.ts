/**
 * Brána: PAT lane na /mcp čte z DB klíče, které DB opravdu vrací — a změna DB dosáhne běžící instance
 *
 * ⛔ NAMĚŘENO 2026-09-14: svc-mcp-knowledge nepřijímal `mcp_` PAT. Nová lane
 * (services/svc-mcp-knowledge/src/auth.ts verifyMcpPat) filtruje tools/list
 * a vymáhá tools/call podle `allowed_tools` / `denied_tools` z výsledku
 * `validate_mcp_token`. Jednotkové testy služby RPC podvrhují — nevidí, když
 * SQL funkce klíč nevrací (lane by pak každý token odmítla jako „bez
 * allowlistu") nebo když změna SoT nedoteče do heals (běžící DB má starou
 * funkci, cold start novou — rozejde se to podle stáří instance).
 *
 * CO BRÁNA HLÍDÁ (čtením zdrojů, bez podprocesu):
 *   1. SoT funkce vrací každý klíč, který lane čte
 *   2. heals.sql SoT soubor zapojuje (jinak se na běžící DB nepřehraje)
 *   3. lane nečte klíč, který by SQL nevracelo
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SQL = readFileSync(join(ROOT, "aisha/db/sql/functions/validate_mcp_token.sql"), "utf8");
const HEALS = readFileSync(join(ROOT, "aisha/db/heals.sql"), "utf8");
const AUTH = readFileSync(join(ROOT, "services/svc-mcp-knowledge/src/auth.ts"), "utf8");

/** Klíče, které verifyMcpPat čte z výsledku (`vysledek.<klíč>`), bez komentářů. */
function klicePane(): string[] {
  const i = AUTH.indexOf("export async function verifyMcpPat(");
  expect(i, "verifyMcpPat v auth.ts nenalezena — brána by neměřila nic").toBeGreaterThan(-1);
  const telo = AUTH.slice(i, AUTH.indexOf("\n}\n", i)).replace(/\/\/.*$/gm, "");
  return [...new Set([...telo.matchAll(/vysledek\??\.([a-z_]+)/g)].map((m) => m[1]))].sort();
}

describe("PAT lane na /mcp má zdroj v DB", () => {
  test("lane čte očekávané klíče (jinak by brána měřila prázdnou množinu)", () => {
    expect(klicePane()).toEqual(expect.arrayContaining(["allowed_tools", "denied_tools", "user_id", "valid"]));
  });

  test("validate_mcp_token vrací každý klíč, který lane čte", () => {
    const vracene = new Set([...SQL.matchAll(/'([a-z_]+)',\s*(?:v_token\.|to_jsonb|true|false)/g)].map((m) => m[1]));
    const chybi = klicePane().filter((k) => !vracene.has(k));
    expect(
      chybi,
      "Lane čte z validate_mcp_token klíče, které SQL nevrací. U allowed_tools to znamená, že každý\n" +
        "token skončí jako „bez allowlistu“ (403) — PAT na /mcp by nefungoval nikde.",
    ).toEqual([]);
  });

  test("heals.sql SoT funkci zapojuje (jinak běžící DB zůstane u staré verze)", () => {
    expect(HEALS).toMatch(/^\\ir sql\/functions\/validate_mcp_token\.sql$/m);
  });
});
