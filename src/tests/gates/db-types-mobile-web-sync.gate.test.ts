/**
 * DB types: one SoT → web + mobile (single-source) Gate
 *
 * Background:
 *   TypeScript types are generated in ONE step from the source-of-truth
 *   Postgres schema by `scripts/db/gen-types.mjs`. Every generation path reaches
 *   that one script — `db:types:gen`, `db:types:gen:local`,
 *   `db:types:refresh:local`, and the faithful clean-SoT path
 *   `db:types:refresh:throwaway` (which builds a throwaway DB from infra/postgres,
 *   applies baseline + migrations, then calls gen-types.mjs). That single step
 *   MUST emit BOTH surfaces from the identical generator output:
 *     - web    → src/integrations/db/types.ts
 *     - mobile → mobile-app/src/types/database.ts   (same content, generated header)
 *
 *   The mobile @aisha/api-core client is typed against the mobile artifact, so a
 *   stale or hand-edited copy would silently weaken every mobile rpc()/invoke()
 *   contract. This gate locks the invariant in: it would have caught the state
 *   where the committed web types.ts lagged the SoT by ~88 lines while mobile
 *   was a hand-copy of that stale file. Regenerate-from-SoT is the ONLY
 *   sanctioned path — never hand-edit or copy a single surface.
 *
 * Safety-critical invariant (do NOT regress):
 *   mobile database.ts === <generated header> + (verbatim web types.ts). If the
 *   two artifacts diverge, regenerate BOTH in one step rather than editing
 *   either by hand.
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const WEB_TYPES = resolve(ROOT, "src/integrations/db/types.ts");
const MOBILE_TYPES = resolve(ROOT, "mobile-app/src/types/database.ts");
const GENERATOR = resolve(ROOT, "scripts/db/gen-types.mjs");

function read(path: string): string {
  expect(existsSync(path), `expected file at ${path}`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("db types: one SoT → web + mobile (no drift)", () => {
  test("mobile artifact is the web artifact verbatim, under a generated header", () => {
    const web = read(WEB_TYPES);
    const mobile = read(MOBILE_TYPES);
    // endsWith(web) is the drift assertion: regenerate one surface without the
    // other (or hand-edit either) and the trailing content no longer matches.
    expect(
      mobile.endsWith(web),
      "mobile-app/src/types/database.ts is out of sync with src/integrations/db/types.ts.\n" +
        "Regenerate BOTH in one step: `npm run db:types:gen` (remote) or " +
        "`npm run db:types:refresh:throwaway` (clean SoT). Never hand-edit or copy a single surface.",
    ).toBe(true);
  });

  test("mobile artifact carries the generated / do-not-edit header", () => {
    const mobile = read(MOBILE_TYPES);
    expect(mobile.startsWith("// AUTO-GENERATED")).toBe(true);
    expect(mobile).toMatch(/DO NOT EDIT/);
    expect(mobile).toMatch(/db:types:gen/);
  });

  test("generator emits BOTH surfaces from the identical output", () => {
    const gen = read(GENERATOR);
    // The mobile output path is declared and points at the mobile artifact.
    expect(gen).toMatch(
      /MOBILE_OUTPUT_PATH\s*=\s*path\.join\(\s*ROOT\s*,\s*"mobile-app"\s*,\s*"src"\s*,\s*"types"\s*,\s*"database\.ts"\s*\)/,
    );
    // Both files are written…
    expect(gen).toMatch(/writeFileSync\(\s*OUTPUT_PATH\s*,\s*output\s*\)/);
    // …and the mobile write reuses the SAME generator `output` (header + output),
    // so the two artifacts cannot diverge within a single generation step.
    expect(gen).toMatch(/writeFileSync\(\s*MOBILE_OUTPUT_PATH\s*,\s*MOBILE_HEADER\s*\+\s*output\s*\)/);
  });
});
