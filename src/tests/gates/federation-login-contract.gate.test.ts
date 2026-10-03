/**
 * Federation Login Contract Gate
 *
 * scripts/local/federation-login.sh is the end-to-end proof that a source member
 * federates into a SCOPED aisha session. It needs a LIVE stack (source + broker +
 * aisha), so it can't run in pure CI — but its CONTRACT must not silently rot.
 * This gate locks that contract statically: the script still drives the full
 * federated OTP flow through the broker AND still runs the backend SECURITY
 * checks (member self-scope, RLS denial of the operator surface, provisioning
 * into aisha_auth.users). A regression that quietly drops the mantra mint, the
 * RLS denial, or the provisioning assertion would otherwise pass unnoticed.
 *
 * (The live behavioural counterpart is the guarded e2e that runs only when a
 * stack is up; this is the always-on static floor that protects the flow's shape.)
 *
 * Run: npm run test:gates
 */
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts/local/federation-login.sh");

describe("federation-login.sh contract — the federated member flow stays intact", () => {
  const src = existsSync(SCRIPT) ? readFileSync(SCRIPT, "utf8") : "";

  test("the script exists and is executable", () => {
    expect(existsSync(SCRIPT), "scripts/local/federation-login.sh missing").toBe(true);
    expect(statSync(SCRIPT).mode & 0o111, "script must be executable").toBeTruthy();
  });

  test("drives the broker federation OTP flow (start → login)", () => {
    expect(src).toContain("/auth/source/start");
    expect(src).toContain("/auth/source/login");
    expect(src).toContain("onboardingToken"); // start → token
    expect(src).toContain("$CODE"); // login consumes the OTP code
  });

  test("mints + decodes the scoped aisha session token with federated claims", () => {
    expect(src).toContain("aishaToken");
    // claims that prove a federated, least-privilege session (not an operator)
    expect(src).toContain("source_member");
    expect(src).toContain("federated_from");
  });

  test("OTP is read from Mailhog with the robust extractor (not the naive uppercase grab)", () => {
    expect(src).toMatch(/Mailhog|8025/);
    // the precise-phrasing extractor — guards against re-introducing the noisy
    // first-uppercase-word grab that picked up MIME / ACME / FFFFFF.
    expect(src.includes("directly in the app") || src.includes("one-time password")).toBe(true);
  });

  test("backend check: member sees ONLY their own data (self-scope RPC)", () => {
    expect(src).toContain("audience_get_my_tier");
  });

  test("backend check: RLS denies the operator surface to a plain member", () => {
    expect(src).toContain("audience_admin_"); // an operator-only view
    expect(src).toMatch(/401|403|404/); // expects a denial status, never data
  });

  test("backend check: member is provisioned in aisha_auth.users (id == JWT.sub)", () => {
    expect(src).toContain("aisha_auth.users");
    expect(src).toContain("WHERE email=");
  });
});
