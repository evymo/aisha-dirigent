/**
 * Gate (remediation S1-push-route-auth): every route handler under
 * services/svc-push/src/routes/*.ts must apply authentication.
 *
 * Why this exists: svc-push mounts routes that trigger push notifications and
 * broadcast campaigns. An unauthenticated route here lets any caller send
 * arbitrary push notifications / spam campaigns to end-user devices, and
 * (for the reminder/questionnaire jobs) drive notification workloads with no
 * identity check. Auth is NOT optional on any of these handlers:
 *   - worker / cron / broadcast routes  -> must require service-role
 *     (verifyServiceRole) or gate through authorizeBroadcast.
 *   - user-facing routes                -> must call verifyToken (and
 *     self-target).
 *
 * The contract this gate enforces: each route file must REFERENCE at least one
 * of the auth primitives exported/used by svc-push:
 *     verifyToken | verifyServiceRole | authorizeBroadcast
 *
 * KNOWN-RED at authoring time (branch feat/remediation): only 2 of 6 route
 * files apply auth. The 4 unauthenticated offenders are:
 *     send-push.ts
 *     campaigns.ts
 *     questionnaire-reminders.ts
 *     reminder-notifications.ts
 *
 * After the fix (each offender wires verifyToken / verifyServiceRole /
 * authorizeBroadcast) this gate goes green. Do NOT allowlist offenders — wire
 * the auth. The allowlist below is reserved ONLY for a route file that is
 * provably not an HTTP handler (e.g. a shared helper module colocated in the
 * dir); it is empty today because every file here registers routes.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ROUTES_DIR = "services/svc-push/src/routes";

/** Auth primitives that satisfy the contract when referenced by name. */
const AUTH_TOKENS = ["verifyToken", "verifyServiceRole", "authorizeBroadcast"];

/**
 * Route files that are intentionally NOT HTTP handlers and therefore exempt.
 * Must be justified in-comment. Empty today — every file registers routes.
 */
const ALLOWLIST = new Set<string>([]);

/** Strip `//` and block comments so a commented-out mention doesn't pass. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function routeFiles(): string[] {
  return readdirSync(join(ROOT, ROUTES_DIR))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
}

function appliesAuth(file: string): boolean {
  const src = stripComments(readFileSync(join(ROOT, ROUTES_DIR, file), "utf-8"));
  return AUTH_TOKENS.some((tok) => new RegExp(`\\b${tok}\\b`).test(src));
}

describe("svc-push route auth contract", () => {
  test("every route handler applies auth (verifyToken/verifyServiceRole/authorizeBroadcast)", () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter((f) => !ALLOWLIST.has(f))
      .filter((f) => !appliesAuth(f));

    expect(
      offenders,
      `Unauthenticated svc-push route files (must reference ${AUTH_TOKENS.join(
        " | ",
      )}): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
