/**
 * story-app-prefix-remap.gate.test.ts
 *
 * Arity gate for scripts/lib/story-app.mjs — the SINGLE source of truth that
 * rewrites upstream-authored `aisha-<role>` app names to THIS deployment's own
 * APP_NAME_PREFIX (a fork / story / client instance names its Coolify apps
 * `<prefix>-*`).
 *
 * Incident 2026-07-21: scripts/aisha-redeploy.mjs remapped its wave DAG with the
 * point-free `wave.apps.map(toStoryApp)`. Array.prototype.map invokes its
 * callback as (element, INDEX, array), and toStoryApp's second parameter is an
 * optional `env` — so the numeric index bound to `env`, reading
 * `.APP_NAME_PREFIX` off a number gave undefined, the prefix fell back to
 * "aisha", and the remap silently degraded to the IDENTITY function. No error,
 * no warning. Consequences on every fork/story deploy:
 *
 *   - every wave resolved to zero targets (`wave N: … (no targets)`), so
 *     aisha-redeploy could not bring up a fork stack AT ALL — a differently-named
 *     stack sat at exited:unhealthy and no redeploy could move it;
 *   - SOFT_DEPLOY_APPS kept its `aisha-*` literals while failures arrived
 *     `<prefix>-*`, so an OPTIONAL app's failure was mis-classified as critical
 *     and would halt the whole downstream cascade.
 *
 * Two independent invariants, so a fix to one cannot mask the other:
 *   1. BEHAVIOUR — the helpers survive being passed straight to .map().
 *   2. CALL SITES — no point-free `.map(toStoryApp)` comes back.
 *
 * String-level + direct import, no shell exec and no network, matching
 * redeploy-wave-coverage.gate.test.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { appPrefix, stripStoryPrefix, toStoryApp } from "../../../scripts/lib/story-app.mjs";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

describe("story-app prefix remap", () => {
  test("helpers survive Array.prototype.map's (element, index, array) arity", () => {
    const env = { APP_NAME_PREFIX: "testfork" } as NodeJS.ProcessEnv;
    const prev = process.env.APP_NAME_PREFIX;
    process.env.APP_NAME_PREFIX = "testfork";
    try {
      // The exact shape that shipped broken: point-free, so index -> `env`.
      expect(["aisha-registry", "aisha-core", "aisha-edge"].map(toStoryApp)).toEqual([
        "testfork-registry",
        "testfork-core",
        "testfork-edge",
      ]);
      // Index 0 is the interesting one — falsy, so a `||` guard would hide it.
      expect(["aisha-core"].map(toStoryApp)).toEqual(["testfork-core"]);
      expect(["testfork-core"].map(stripStoryPrefix)).toEqual(["core"]);
      expect([0, 1, 2].map(() => appPrefix())).toEqual([
        "testfork",
        "testfork",
        "testfork",
      ]);
    } finally {
      if (prev === undefined) delete process.env.APP_NAME_PREFIX;
      else process.env.APP_NAME_PREFIX = prev;
    }

    // An EXPLICIT env argument must still win — the arity guard must not
    // collapse the override into process.env.
    expect(toStoryApp("aisha-core", env)).toBe("testfork-core");
    expect(toStoryApp("aisha-core", { APP_NAME_PREFIX: "testfork" } as NodeJS.ProcessEnv)).toBe("testfork-core");
    // ⛔ ZMĚNĚNO 2026-08-24 (majitel: „žádný fallback, musí to být přesné,
    // project specific"). Do té doby tu stálo, že PRÁZDNÉ prostředí „pořád
    // znamená upstream stack" — a tím bylo tvrzení STRÁŽCEM fallbacku
    // `APP_NAME_PREFIX || "aisha"`. Nedeklarovaná identita ale není „upstream",
    // je to NEZNÁMÝ CÍL: na sdíleném Coolify tak `reconcile-oidc-secrets.mjs`
    // zamířil na cizí `aisha-*` a s `--apply` by tam zapsal naše tajemství.
    // Neznámý cíl teď selže nahlas.
    expect(() => toStoryApp("aisha-core", {} as NodeJS.ProcessEnv)).toThrow(/APP_NAME_PREFIX/);
  });

  test("no orchestration script reintroduces a point-free .map(toStoryApp)", () => {
    const offenders: string[] = [];
    for (const rel of ["scripts/aisha-redeploy.mjs", "scripts/lib/story-app.mjs"]) {
      const src = read(rel);
      src.split(/\r?\n/).forEach((line, i) => {
        // Comment lines legitimately QUOTE the broken form to explain it (both
        // files carry that warning) — scan code only, else the gate flags its
        // own documentation.
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (/\.(map|filter|flatMap|forEach)\(\s*(toStoryApp|stripStoryPrefix)\s*\)/.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${trimmed}`);
        }
      });
    }
    expect(
      offenders,
      "point-free .map(toStoryApp) binds the array INDEX to the optional `env` " +
        "parameter, silently degrading the remap to identity. Use " +
        "`.map((n) => toStoryApp(n))`.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
