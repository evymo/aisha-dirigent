/**
 * No Spoofable-Header Authorization Gate (OWASP A01 / A07)
 *
 * A service must NEVER make an authorization decision from a client-supplied
 * identity header (e.g. `req.headers['x-aisha-user-role']`). Any caller able to
 * reach the service port can set such a header to `admin` → full auth bypass.
 * Internal-only is no defense: services share the mesh/coolify network and are
 * classic lateral-movement / SSRF targets.
 *
 * Authorization must be derived from a *verified* credential — a Keycloak JWT
 * (`@aisha/security` `createJwtVerifier` → `realm_access.roles`) or a
 * constant-time-compared shared service token (`verifyServiceRole`).
 *
 * This gate caught svc-source-broker `/sync/run` trusting `x-aisha-user-role`
 * (fixed in src/auth-guard.ts). Runs via: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const SERVICES = join(ROOT, "services");

/** Recursively collect *.ts source files under a dir (skips node_modules/dist/tests). */
function collectTs(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__tests__" || name === "tests") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectTs(p, acc);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

// Bracket-access of a client identity header — the spoofable-authz anti-pattern.
// (Comments/string docs use backticked `X-Aisha-User-Role` without `headers[`, so
// they don't match — only real header reads do.)
const SPOOFABLE_HEADER_ACCESS =
  /headers\s*\[\s*['"`]x-(aisha-)?user-(role|id|email|sub)['"`]\s*\]/i;

describe("No spoofable-header authorization in services", () => {
  const files = existsSync(SERVICES) ? collectTs(SERVICES) : [];

  test("service sources do not read x-aisha-user-* identity headers (use verified JWT/service-token instead)", () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      content.split("\n").forEach((line, i) => {
        if (SPOOFABLE_HEADER_ACCESS.test(line)) {
          offenders.push({ file: file.replace(ROOT + "/", ""), line: i + 1, text: line.trim() });
        }
      });
    }
    expect(
      offenders,
      `Spoofable-header authorization detected (${offenders.length}). Authorize off a ` +
        `verified Keycloak JWT (createJwtVerifier → realm_access.roles) or a constant-time ` +
        `service token (verifyServiceRole), never a client-supplied header:\n` +
        offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join("\n"),
    ).toEqual([]);
  });

  test("svc-source-broker /sync routes are guarded by verified auth", () => {
    const sync = join(SERVICES, "svc-source-broker/src/routes/sync.ts");
    if (!existsSync(sync)) return; // broker optional in some forks
    const content = readFileSync(sync, "utf-8");
    // Both mutating/diagnostic routes must run the verified-auth preHandler.
    expect(content).toMatch(/createAuthGuard\(config\)/);
    expect(content).toMatch(/'\/sync\/run',\s*\{\s*preHandler:\s*guard\.requireAdminOrService\s*\}/);
    expect(content).toMatch(/'\/sync\/probe',\s*\{\s*preHandler:\s*guard\.requireAdminOrService\s*\}/);
  });

  test("broker auth-guard verifies a JWT and a constant-time service token (never a header)", () => {
    const guard = join(SERVICES, "svc-source-broker/src/auth-guard.ts");
    if (!existsSync(guard)) return;
    const content = readFileSync(guard, "utf-8");
    expect(content).toMatch(/createJwtVerifier/);
    expect(content).toMatch(/verifyServiceRole/);
    expect(content).toMatch(/realm_access\?\.roles/);
    // Must NOT authorize off the spoofable header.
    expect(SPOOFABLE_HEADER_ACCESS.test(content)).toBe(false);
  });
});
