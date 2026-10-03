/**
 * Federation Stack Integrity Gate
 *
 * The svc-source-broker federation broker is a first-class OPTIONAL stack
 * ("source-broker"). This gate makes its registration self-validating and locks
 * the opt-in + security invariants — so removing any one wiring point, or
 * leaking the dev bypass into prod, fails CI. Holds for BOTH local and prod.
 *
 *   1. REGISTRATION COMPLETENESS — source-broker is wired into every place an
 *      optional stack must appear: cold-start STACKS, coolify-deploy-init.sh
 *      (ALL_STACKS + each lookup case function + UUID var), the manifest,
 *      config/services.json, and the redeploy WAVES + SOFT_DEPLOY_APPS. A
 *      half-registered stack silently fails to deploy; this catches that.
 *   2. OPT-IN — coolify-story-init.sh provisions the Coolify app only when
 *      SOURCE_API_URL is set; init-new-tenant.sh generates the federation env.
 *   3. SECURITY — the dev /sync bypass (BROKER_DEV_ALLOW_UNAUTHED_SYNC) appears
 *      ONLY in the thin local overlay, NEVER in the canonical prod compose.
 *
 * Run: npm run test:gates
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

const DEPLOY_INIT = read("scripts/coolify-deploy-init.sh");
const COLD_START = read("scripts/aisha-cold-start.sh");
const MANIFEST = read("coolify/manifests/aisha.manifest");
const SERVICES = read("config/services.json");
const REDEPLOY = read("scripts/aisha-redeploy.mjs");
const STORY_INIT = read("scripts/coolify-story-init.sh");
const INIT_TENANT = read("scripts/init-new-tenant.sh");
const CANON_COMPOSE = read("docker-compose.coolify-source-broker.yml");
// Compose files carry configuration only — their prose lives beside them, because
// Coolify ships the YAML as a command-line argument and it competes with ARG_MAX
// (scripts/compose-extract-notes.mjs). An assertion that a DECISION is documented
// must therefore look where the documentation is, while assertions about
// CONFIGURATION keep reading the YAML.
const CANON_NOTES = read("docs/compose-notes/docker-compose.coolify-source-broker.yml.md");
const LOCAL_OVERLAY = read("docker-compose.local.source-broker.yml");

describe("source-broker is fully + consistently registered across coolify-deploy-init.sh", () => {
  test("ALL_STACKS includes source-broker", () => {
    expect(DEPLOY_INIT).toMatch(/ALL_STACKS="[^"]*\bsource-broker\b/);
  });
  // Each lookup function that drives discovery/deploy must know the stack, else
  // it half-registers: wrong compose, no label, undiscoverable UUID.
  test("stack_compose maps source-broker → its canonical compose", () => {
    expect(DEPLOY_INIT).toMatch(/source-broker\)\s+echo "docker-compose\.coolify-source-broker\.yml"/);
  });
  test("stack_label has a source-broker label", () => {
    expect(DEPLOY_INIT).toMatch(/source-broker\)\s+echo "Source Broker/);
  });
  test("stack_app_name maps source-broker → ${prefix}-source-broker", () => {
    expect(DEPLOY_INIT).toMatch(/source-broker\)\s+echo "\$\{prefix\}-source-broker"/);
  });
  test("stack_jq_filter discovers the source-broker app", () => {
    expect(DEPLOY_INIT).toMatch(/source-broker\)\s+echo "\$\{guard\}[\s\S]*?coolify-source-broker/);
  });
  test("UUID_SOURCE_BROKER var + get/set_stack_uuid cases exist", () => {
    expect(DEPLOY_INIT).toMatch(/UUID_SOURCE_BROKER="\$\{UUID_SOURCE_BROKER:-\}"/);
    expect(DEPLOY_INIT).toMatch(/source-broker\)\s+echo "\$UUID_SOURCE_BROKER"/);
    expect(DEPLOY_INIT).toMatch(/source-broker\)\s+UUID_SOURCE_BROKER="\$2"/);
  });
});

describe("source-broker is registered across the rest of the cold-start surface", () => {
  test("cold-start STACKS lists source-broker", () => {
    expect(COLD_START).toMatch(/STACKS="[^"]*\bsource-broker\b/);
  });
  test("manifest declares the source-broker app with its canonical compose", () => {
    expect(MANIFEST).toMatch(/^app: *source-broker:backend:docker-compose\.coolify-source-broker\.yml/m);
  });
  test("config/services.json registers source-broker (tier=optional, backend, canonical compose)", () => {
    const j = JSON.parse(SERVICES);
    const node = j.services?.["source-broker"];
    expect(node, "source-broker missing from config/services.json").toBeTruthy();
    expect(node.tier).toBe("optional");
    expect(node.placement).toBe("backend");
    expect(node.compose).toBe("docker-compose.coolify-source-broker.yml");
  });
  test("redeploy places aisha-source-broker in a wave AND in SOFT_DEPLOY_APPS", () => {
    expect(REDEPLOY).toMatch(/apps:\s*\[[^\]]*"aisha-source-broker"/);
    expect(REDEPLOY).toMatch(/SOFT_DEPLOY_APPS\s*=\s*new Set\(\[[\s\S]*?"aisha-source-broker"/);
  });
});

describe("federation opt-in + security contract", () => {
  test("the broker's opt-in gate is DERIVED from the catalog, which declares every lane", () => {
    // Contract, not shape. This assertion used to pin the literal bash
    //   [ "$role" = "source-broker" ] && [ -z "${SOURCE_API_URL:-}" ]
    // i.e. it froze a hand-written COPY of the catalog in place. When the broker
    // grew a second, federation-independent lane (li-driver → li_*, 2026-07-15)
    // that copy still named only the federation var, so the only writer into
    // li_* could not be provisioned at all — and this gate could not notice,
    // because it was checking the shape of the copy instead of the condition
    // (found 2026-07-20). Assert the declaration and the derivation instead.
    const j = JSON.parse(SERVICES);
    const gate = j.services?.["source-broker"]?.provision_when_env;
    const lanes = Array.isArray(gate) ? gate : [gate];
    expect(lanes, "broker must declare its federation lane").toContain("SOURCE_API_URL");
    expect(lanes, "broker must declare its drop-replay lane (li-driver → li_*)")
      .toContain("LOCAL_INGEST_DROP_DIR");
    // …and story-init must READ that declaration rather than restate it.
    expect(STORY_INIT).toMatch(/provision_when_env/);
    expect(STORY_INIT).toMatch(/provision_gate_skips\s+"\$role"/);
  });
  test("no opt-in condition is hand-written per role in story-init (anti-drift)", () => {
    // Any `[ "$role" = "x" ] && [ -z "${SOME_VAR:-}" ]` is a second copy of a
    // condition that already lives in config/services.json, and copies drift.
    // Declare the gate in the catalog; provision_gate_skips() derives it.
    const handWritten =
      STORY_INIT.match(/"\$role"\s*=\s*"[a-z-]+"\s*\]?\s*\\?\s*&&\s*\[\s*-z\s*"\$\{[A-Z_]+:-\}"/g) ?? [];
    expect(handWritten, `hand-written opt-in gate(s) found: ${handWritten.join(" ; ")}`)
      .toEqual([]);
  });
  test("init-new-tenant generates the federation env scaffolding (correct-by-construction)", () => {
    expect(INIT_TENANT).toMatch(/KC_ALLOWED_CLIENTS=\$\{CLIENT_PREFIX\}app/);
    expect(INIT_TENANT).toMatch(/BROKER_DOMAIN=broker\.\$BASE_DOMAIN/);
  });
  test("the canonical (prod) compose NEVER sets the dev /sync bypass", () => {
    // The bypass must not be an env ASSIGNMENT (a `KEY: "value"` line). The
    // documentation comment that explains the omission is allowed (and required).
    expect(CANON_COMPOSE).not.toMatch(/^\s*BROKER_DEV_ALLOW_UNAUTHED_SYNC:/m);
    expect(CANON_NOTES).toMatch(/BROKER_DEV_ALLOW_UNAUTHED_SYNC is intentionally NOT set/);
  });
  test("the dev /sync bypass lives ONLY in the thin local overlay", () => {
    expect(LOCAL_OVERLAY).toMatch(/BROKER_DEV_ALLOW_UNAUTHED_SYNC:\s*"true"/);
  });
});
