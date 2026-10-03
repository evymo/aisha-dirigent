/**
 * Gate: every opt-in service's provision flag must reach .env.coolify.
 *
 * WHY THIS EXISTS (recurring class: source-broker 2026-07-20, potok 2026-07-21)
 * ---------------------------------------------------------------------------
 * An opt-in service is gated by a `provision_when_env` variable in
 * config/services.json. The operator declares it in .env.local; cold-start
 * sources .env.local, so the in-shell value is present and coolify-story-init.sh
 * CREATES the app. But .env.coolify is written by a heredoc in aisha-cold-start.sh,
 * and a variable only lands in .env.coolify if the heredoc has an explicit
 * `VAR=${VAR:-}` line. Miss that line and the flag never reaches Coolify:
 *
 *   - the app exists but its env is incomplete;
 *   - a later env sync reads .env.coolify, sees the flag unset, classifies the
 *     service unprovisioned, and never delivers its env (e.g. its NetBird setup
 *     key) — measured 2026-07-21: <fork>-potok stuck on "setup key is invalid".
 *
 * The class recurs because the heredoc is a hand-maintained list. This gate makes
 * it a derived property instead: the set of flags to bind is read from
 * services.json, so a new opt-in service is covered the day it declares its gate.
 */

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");
const SERVICES = join(ROOT, "config/services.json");

/** Every provision_when_env variable declared in the catalog. */
function provisionFlags(): string[] {
  const cat = JSON.parse(readFileSync(SERVICES, "utf-8"));
  const svcs = cat.services ?? cat;
  const out = new Set<string>();
  for (const s of Object.values(svcs) as Array<Record<string, unknown>>) {
    const g = s?.provision_when_env as string | string[] | undefined;
    if (!g) continue;
    for (const v of Array.isArray(g) ? g : [g]) if (v) out.add(String(v));
  }
  return [...out].sort();
}

describe("cold-start heredoc binds every opt-in provision flag", () => {
  test("services.json declares at least one provision flag (fixture sanity)", () => {
    expect(provisionFlags().length).toBeGreaterThan(0);
  });

  test("every provision_when_env var is passed through to .env.coolify", () => {
    const src = readFileSync(COLD_START, "utf-8");
    // The heredoc passthrough shape is `VAR=${VAR...}` on its own line — the
    // operator's sourced value flowing into the written artifact. A bare mention
    // in a comment does not count, so require the assignment form.
    const missing = provisionFlags().filter((v) => {
      const assign = new RegExp(`^\\s*${v}=\\$\\{${v}`, "m");
      return !assign.test(src);
    });
    expect(
      missing,
      "these opt-in flags are declared in services.json but never written to .env.coolify by " +
        "the cold-start heredoc, so a fresh wipe leaves the service unprovisioned",
    ).toEqual([]);
  });
});
