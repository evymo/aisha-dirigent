/**
 * No developer / account codes Gate
 *
 * Background:
 *   Apple Team IDs, App Store Connect key ids, personal account emails, and
 *   real `AuthKey_<id>.p8` filenames must never be
 *   committed — they belong in the environment (`${env:APPLE_TEAM_ID}`,
 *   `$APPLE_TEAM_ID`) or in gitignored `.env*` / `.p8` files. They leaked once
 *   into the mobile publishing kit + a VS Code task + a rebrand script; this
 *   gate (plus the matching `.husky/pre-commit` step) stops them coming back.
 *
 * The scan logic lives in scripts/verify-no-dev-codes.mjs (shared with the
 * pre-commit guard so the rules can't drift). This gate (a) asserts the tracked
 * tree is clean, and (b) unit-tests that the rules catch the leaked forms while
 * allowing env / placeholder / alias forms.
 *
 * Spouští se přes: npm run test:gates
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { scanText, scanRepo } from "../../../scripts/verify-no-dev-codes.mjs";

const ROOT = process.cwd();
const GUARD = resolve(ROOT, "scripts/verify-no-dev-codes.mjs");

const email = (localPart: string, domain: string): string => `${localPart}@${domain}`;
const caught = (s: string): boolean => scanText(s).length > 0;

describe("no developer/account codes", () => {
  test("guard script exists", () => {
    expect(existsSync(GUARD), `expected guard at ${GUARD}`).toBe(true);
  });

  test("tracked tree is clean — no Apple Team ID / ASC key id / personal account email", () => {
    const offenders = scanRepo({ staged: false }) as string[];
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });

  test("detects the leaked / hardcoded forms", () => {
    expect(caught(email("info", "evymo.com"))).toBe(true);
    expect(caught(email("zdenek", "evymo.com"))).toBe(true); // personal account (was baked into the realm)
    expect(caught(email("premma", "gmail.com"))).toBe(true); // second personal account
    expect(caught('"DEVELOPMENT_TEAM=8N4327J6T3",')).toBe(true);
    expect(caught("AuthKey_5PJ3Y2UVV9.p8")).toBe(true);
    expect(caught("APPLE_TEAM_ID=ABCDE12345")).toBe(true); // any future team id
    expect(caught("AuthKey_AB12CD34EF.p8")).toBe(true); // any future key id
    expect(caught("cd /Users/alice/projects/foo")).toBe(true); // any machine home path
  });

  test("allows env / placeholder / alias / portable forms", () => {
    expect(caught("DEVELOPMENT_TEAM=${env:APPLE_TEAM_ID}")).toBe(false);
    expect(caught("APPLE_TEAM_ID=$APPLE_TEAM_ID")).toBe(false);
    expect(caught("teamID: process.env.APPLE_TEAM_ID")).toBe(false);
    expect(caught("AuthKey_XXXXXXXXXX.p8")).toBe(false);
    expect(caught("security@evymo.com")).toBe(false); // role alias, allowed
    expect(caught("noreply@evymo.com")).toBe(false); // role alias, allowed
    expect(caught("admin@evymo.com")).toBe(false); // functional service address
    expect(caught("legal@evymo.com")).toBe(false); // role alias for entity CLA contact, allowed
    expect(caught("zdenek@aisha.guru")).toBe(false); // legal DPO contact (privacy policy) — kept
    expect(caught("sets APPLE_TEAM_ID + signing config — values never committed")).toBe(false);
    expect(caught('cd "$(git rev-parse --show-toplevel)"')).toBe(false); // portable repo root
    expect(caught("cd $HOME/projects/foo")).toBe(false);
    expect(caught("${workspaceFolder}/ios/App.xcworkspace")).toBe(false);
    expect(caught("/Users/Shared/config.json")).toBe(false); // shared dir, not a home
    expect(caught("/Users/dev/project/src/x.ts")).toBe(false); // placeholder username (test fixtures)
    expect(caught("/Users/demouser4/projects/foo")).toBe(false); // demo seed data
  });
});
