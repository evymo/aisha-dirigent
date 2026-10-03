/**
 * Brána: adresu PostgRESTu, kterou dodá integrační harness, vitest konfigurace služby nepřebije.
 *
 * ⛔ NAMĚŘENO 2026-09-13: `npm run test:integration:rag-eval` padal
 * `ENOTFOUND test-postgrest.invalid`, ačkoli scripts/db/with-throwaway-postgrest.mjs PostgREST
 * spustil a POSTGREST_URL exportoval. `test.env` ve vitest.config.ts služby přiřazuje
 * BEZPODMÍNEČNĚ (vitest 3.2.6 setupEnv: `for (const key in restEnvs) process.env[key] = env[key]`),
 * takže literál `http://test-postgrest.invalid:3000` pro unit lane přepsal adresu harnessu.
 * Totéž platilo pro svc-ai-chat (test:reflection:*, test:flowboard:*).
 *
 * Vlastnost (třída, ne jmenovitý seznam): KAŽDÁ služba, do které package.json skript
 * vstupuje přes with-throwaway-postgrest.mjs, nesmí v `test.env` přiřadit POSTGREST_URL
 * literálem — adresu rozhoduje deklarovaná lane (scripts/test/postgrest-vstup-testu.mjs).
 * A harness lane deklaruje (AISHA_TEST_LANE=integration).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NEROZRESITELNY_POSTGREST, postgrestVstupTestu } from "../../../scripts/test/postgrest-vstup-testu.mjs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

/** Služby, do kterých skript vstupuje přes harness PostgRESTu (`… with-throwaway-postgrest.mjs -- … cd services/<x>`). */
export function sluzbyZaHarnessem(scripts: Record<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [jmeno, prikaz] of Object.entries(scripts)) {
    const i = prikaz.indexOf("with-throwaway-postgrest.mjs");
    if (i === -1) continue;
    for (const m of prikaz.slice(i).matchAll(/\bcd\s+services\/([a-z0-9-]+)/g)) {
      out.set(m[1], [...(out.get(m[1]) ?? []), jmeno]);
    }
  }
  return out;
}

/** Přiřazuje `test.env` konfigurace POSTGREST_URL literálem? (komentáře se nečtou) */
export function priraduje(config: string): boolean {
  const kod = config.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return /\bPOSTGREST_URL\s*:\s*['"`]/.test(kod);
}

describe("integrační lane drží adresu PostgRESTu z harnessu", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  const sluzby = sluzbyZaHarnessem(pkg.scripts);

  test("fixture: harness pouští aspoň služby, kde se to stalo", () => {
    expect([...sluzby.keys()]).toEqual(expect.arrayContaining(["svc-mcp-knowledge", "svc-ai-chat"]));
  });

  test("⛔ žádná služba za harnessem nepřiřazuje POSTGREST_URL v test.env literálem", () => {
    const nalezy = [...sluzby.entries()]
      .filter(([svc]) => {
        const cesta = `services/${svc}/vitest.config.ts`;
        return existsSync(join(ROOT, cesta)) && priraduje(read(cesta));
      })
      .map(([svc, skripty]) => `services/${svc}/vitest.config.ts (skripty: ${skripty.join(", ")})`);
    expect(
      nalezy,
      "test.env přebíjí prostředí bezpodmínečně — adresu harnessu by přepsal literál. " +
        "Použij `...postgrestVstupTestu(process.env)` (scripts/test/postgrest-vstup-testu.mjs).",
    ).toEqual([]);
  });

  test("⛔ harness lane deklaruje (AISHA_TEST_LANE=integration vedle POSTGREST_URL)", () => {
    const harness = read("scripts/db/with-throwaway-postgrest.mjs");
    const blok = harness.match(/const runEnv = \{[\s\S]*?\};/)?.[0] ?? "";
    expect(blok, "fixture: runEnv harnessu nenalezen").toContain("POSTGREST_URL");
    expect(blok).toMatch(/AISHA_TEST_LANE:\s*['"]integration['"]/);
  });

  test("chování: unit lane dostane nerozřešitelnou adresu, integrační nic, rozbitý harness chybu", () => {
    expect(postgrestVstupTestu({})).toEqual({ POSTGREST_URL: NEROZRESITELNY_POSTGREST });
    expect(postgrestVstupTestu({ POSTGREST_URL: "http://skutecna:3000" }), "unit lane síť nemá ani s adresou v shellu")
      .toEqual({ POSTGREST_URL: NEROZRESITELNY_POSTGREST });
    expect(postgrestVstupTestu({ AISHA_TEST_LANE: "integration", POSTGREST_URL: "http://127.0.0.1:1" })).toEqual({});
    expect(() => postgrestVstupTestu({ AISHA_TEST_LANE: "integration" })).toThrow(/POSTGREST_URL chybí/);
    expect(() => postgrestVstupTestu({ AISHA_TEST_LANE: "e2e" })).toThrow(/neznám/);
  });

  test("negativní sonda: tvar konfigurace do 2026-09-13 je nález, komentář a spread ne", () => {
    const stary = "export default defineConfig({ test: { env: {\n  POSTGREST_URL: 'http://test-postgrest.invalid:3000',\n} } });";
    expect(priraduje(stary)).toBe(true);
    expect(priraduje("env: { ...postgrestVstupTestu(process.env) }, // POSTGREST_URL: 'x'")).toBe(false);
    expect(
      sluzbyZaHarnessem({
        a: "node scripts/db/with-throwaway-postgrest.mjs -- bash -c 'cd services/svc-x && npx vitest run'",
        b: "cd services/svc-y && npx vitest run",
      }),
    ).toEqual(new Map([["svc-x", ["a"]]]));
  });
});
