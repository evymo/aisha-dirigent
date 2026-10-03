/**
 * Brána: klíč pole akce správy má JEDNO pravidlo — klient (maska action_form,
 * packages/surface-blocks) i server (submit_surface_action) ho píšou stejně.
 *
 * ⛔ NAMĚŘENO 2026-09-27: server bral `^[a-zA-Z][a-zA-Z0-9_]*$` (camelCase od
 * 2026-09-26, „klíče jdou jen do jsonb"), klient dál `^[a-z][a-z0-9_]*$`. Pole
 * `baseUrl` formuláře „AVP — připojení" se v extranetu nevykreslilo, tlačítko
 * zůstalo neaktivní a připojení AVP nešlo zadat — server by ho přitom přijal.
 * Dvě znění jednoho pravidla se rozejdou vždy; tady se měří, že jsou shodná.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const klient = readFileSync(join(ROOT, "packages/surface-blocks/src/schemas.ts"), "utf8");
const server = readFileSync(join(ROOT, "aisha/db/sql/functions/submit_surface_action.sql"), "utf8");

describe("klíč pole akce: klient a server mají totéž pravidlo", () => {
  it("obě znění se najdou (jinak brána měří prázdno) a jsou shodná", () => {
    // klient: `key: { type: 'string', pattern: '…' }` uvnitř fields akce
    const k = /\bkey:\s*\{\s*type:\s*'string',\s*pattern:\s*'([^']+)'\s*\}/.exec(klient)?.[1];
    // server: `CONTINUE WHEN v_key IS NULL OR v_key !~ '…'`
    const s = /v_key\s*!~\s*'([^']+)'/.exec(server)?.[1];
    expect(k, "pravidlo klíče v schemas.ts nenalezeno").toBeTruthy();
    expect(s, "pravidlo klíče v submit_surface_action.sql nenalezeno").toBeTruthy();
    expect(k).toBe(s);
  });

  it("kontrolní vzorek: klíč, který server přijímá (baseUrl), klient nezahodí", () => {
    const k = /\bkey:\s*\{\s*type:\s*'string',\s*pattern:\s*'([^']+)'\s*\}/.exec(klient)?.[1] ?? "";
    expect(new RegExp(k).test("baseUrl")).toBe(true);
    expect(new RegExp(k).test("base-url")).toBe(false);
  });
});
