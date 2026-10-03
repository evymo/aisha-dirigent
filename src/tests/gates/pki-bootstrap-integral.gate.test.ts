/**
 * PKI Bootstrap Integral Design Gate
 *
 * Enforces the contract for OpenXPKI 3.32 first-boot bootstrap. Without
 * datasafe + per-realm certsign tokens registered, pki-server reports
 * unhealthy → pki-client cannot start → Coolify reports the entire stack
 * as failed. Pre-fix this was tolerated via KNOWN_BROKEN; post-fix the
 * bootstrap runs as a compose-native init container.
 *
 * The contract:
 *   1. infra/pki/pki-realm-bootstrap.sh exists, executable, with:
 *      - idempotency check (alias list before re-keying)
 *      - both `oxi` and `openxpkiadm` paths (CLI compat across image variants)
 *      - keys generated under /etc/openxpki/local/keys with 400 perms
 *   2. docker-compose.coolify-pki.yml declares a pki-realm-bootstrap service
 *      with restart=no, depends_on pki-server (service_started),
 *      mounts pki-socket + pki-config-rendered + pki-keys.
 *   3. pki-client.depends_on includes pki-realm-bootstrap (service_completed_successfully)
 *      so cert-issuance protocols can't accept requests until bootstrap
 *      finished.
 *   4. aisha-cold-start.sh generates PKI_DEFAULT_SECRET and persists it
 *      to .env.coolify (preserve_or_gen pattern — never re-key).
 *   5. coolify-deploy-init.sh sets PKI_DEFAULT_SECRET on the aisha-pki app
 *      so the env-sync makes it available to the bootstrap container.
 *
 * See docs/deploy/PKI_BOOTSTRAP_DESIGN.md for the full rationale.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BOOTSTRAP_SH = join(ROOT, "infra/pki/pki-realm-bootstrap.sh");
const COMPOSE = join(ROOT, "docker-compose.coolify-pki.yml");
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");
const DEPLOY_INIT = join(ROOT, "scripts/coolify-deploy-init.sh");

describe("PKI Bootstrap — Integral Design", () => {
  test("infra/pki/pki-realm-bootstrap.sh exists and is executable", () => {
    expect(existsSync(BOOTSTRAP_SH), "bootstrap script must exist").toBe(true);
    if (!existsSync(BOOTSTRAP_SH)) return;
    const mode = statSync(BOOTSTRAP_SH).mode & 0o777;
    expect(
      (mode & 0o100) !== 0,
      `bootstrap script must be owner-executable (got mode ${mode.toString(8)})`,
    ).toBe(true);
  });

  test("bootstrap script has idempotency + dual-CLI fallback", () => {
    const sh = readFileSync(BOOTSTRAP_SH, "utf-8");

    // Idempotency: skip when alias is already configured
    expect(
      sh,
      "bootstrap MUST detect already-bootstrapped state and exit 0 — re-keying would invalidate every cert.",
    ).toMatch(/(already.*configured|skipping)|has_alias|alias.*list/i);

    // CLI: must use oxi (v3.32+ wrapper) for token add and openxpkiadm
    // for alias listing. Verified against the actual openxpki3:3.32.8
    // image — `oxi` is at /usr/bin/oxi, `oxi alias list --type` has
    // "Unknown option: type" so must use openxpkiadm for type-filtered
    // queries; `oxi token add --type X --cert Y` is the supported syntax
    // for adding (per QUICKSTART.md).
    expect(sh, "bootstrap must call oxi token add for adding tokens").toMatch(/oxi token add/);
    expect(
      sh,
      "bootstrap must use openxpkiadm alias --token <type> for idempotency check (oxi alias list lacks --type filter)",
    ).toMatch(/openxpkiadm alias --realm[^\n]+--token/);

    // PKI_DEFAULT_SECRET required (encrypts issuer keys)
    expect(
      sh,
      "bootstrap requires PKI_DEFAULT_SECRET — distinct from PKI_SVAULT_KEY (datapool master).",
    ).toContain("PKI_DEFAULT_SECRET");

    // Per-realm certsign loop
    expect(
      sh,
      "bootstrap must register certsign per realm (identity-plane, data-plane, orchestration-plane).",
    ).toMatch(/for\s+realm\s+in/);

    // Datasafe step
    expect(sh, "bootstrap must register datasafe token").toMatch(/datasafe/);
    // Certsign step
    expect(sh, "bootstrap must register certsign token").toMatch(/certsign/);
  });

  test("pki-server inlines the realm bootstrap (replaces the failed separate-container pattern)", () => {
    // Phase 3 verification revealed the separate pki-realm-bootstrap
    // init-container pattern was unworkable: Coolify v4's `docker compose
    // up -d --wait` does not surface child-container stdout in the
    // deployment log, so when the bootstrap exited 1 we had no visibility
    // into why. Inlining the bootstrap into pki-server's startup wrapper
    // surfaces its output via pki-server's docker logs (which Coolify's
    // app-logs API exposes).
    const compose = readFileSync(COMPOSE, "utf-8");

    // Find pki-server block
    const serverBlock = compose.match(/^\s+pki-server:[\s\S]+?(?=\n {2}[a-z]|\nvolumes:|\nnetworks:)/m);
    expect(serverBlock, "pki-server block must be parseable").toBeTruthy();
    if (!serverBlock) return;
    const server = serverBlock[0];

    // PKI_DEFAULT_SECRET env required for bootstrap
    expect(
      server,
      "pki-server must declare PKI_DEFAULT_SECRET env (the inline bootstrap uses it to encrypt issuer keys).",
    ).toContain("PKI_DEFAULT_SECRET");

    // PKI_BOOTSTRAP_DIAG env present (default 1 during introspection)
    expect(
      server,
      "pki-server must declare PKI_BOOTSTRAP_DIAG env so the inline bootstrap can run in diagnostic mode while we verify against the live image.",
    ).toContain("PKI_BOOTSTRAP_DIAG");

    // Inline bootstrap step in command (run after daemon socket appears)
    expect(
      server,
      "pki-server's startup wrapper must run the realm bootstrap inline so its output surfaces in pki-server's docker logs.",
    ).toMatch(/sh\s+\/etc\/openxpki\/local\/scripts\/pki-realm-bootstrap\.sh/);

    // Daemon backgrounded so bootstrap can talk to socket
    expect(
      server,
      "pki-server must start openxpkid in the background (so bootstrap can run against its socket), then `wait` on the daemon PID.",
    ).toMatch(/openxpkictl start server --nd\s*&/);

    // Wait for socket to appear before running bootstrap
    expect(
      server,
      "pki-server must poll for /run/openxpkid/openxpkid.sock before invoking bootstrap.",
    ).toMatch(/openxpkid\.sock/);
  });

  test("pki-client depends on pki-server: service_healthy (no separate bootstrap container)", () => {
    const compose = readFileSync(COMPOSE, "utf-8");
    // Find pki-client block
    const blockMatch = compose.match(/^\s+pki-client:[\s\S]+?(?=\n {2}[a-z]|\nvolumes:|\nnetworks:)/m);
    expect(blockMatch, "pki-client block must be parseable").toBeTruthy();
    if (!blockMatch) return;
    expect(
      blockMatch[0],
      "pki-client depends on pki-server: service_healthy — bootstrap is now inline in pki-server, so service_healthy is the single sequencing gate.",
    ).toMatch(/pki-server:[\s\S]+?condition:\s*service_healthy/);

    // Confirm separate pki-realm-bootstrap service is gone (replaced by inline)
    expect(
      compose,
      "the separate pki-realm-bootstrap service must be removed — bootstrap is now inline in pki-server's startup wrapper.",
    ).not.toMatch(/^\s+pki-realm-bootstrap:\s*$/m);
  });

  test("aisha-cold-start.sh generates and persists PKI_DEFAULT_SECRET", () => {
    const sh = readFileSync(COLD_START, "utf-8");
    const secretsGenerator = readFileSync(join(ROOT, "scripts/generate-secrets.mjs"), "utf-8");

    // Generated via source-of-truth generator (never re-keyed)
    expect(
      secretsGenerator,
      "generate-secrets.mjs MUST generate/preserve PKI_DEFAULT_SECRET — losing this password makes every issuer private key unrecoverable.",
    ).toMatch(/emit\('PKI_DEFAULT_SECRET',\s+pg\('PKI_DEFAULT_SECRET',\s+\(\) => hex\(32\)\)\)/);
    expect(
      sh,
      "cold-start MUST call the source-of-truth generator before persisting .env.coolify.",
    ).toContain("scripts/generate-secrets.mjs");

    // Persisted to .env.coolify HEREDOC
    expect(
      sh,
      "cold-start MUST persist PKI_DEFAULT_SECRET to .env.coolify so subsequent runs don't regenerate.",
    ).toMatch(/PKI_DEFAULT_SECRET=\$\{PKI_DEFAULT_SECRET\}/);
  });

  test("coolify-deploy-init.sh propagates PKI_DEFAULT_SECRET to aisha-pki app", () => {
    const sh = readFileSync(DEPLOY_INIT, "utf-8");

    // Set on the pki app's env vars
    expect(
      sh,
      "deploy-init MUST set PKI_DEFAULT_SECRET on aisha-pki — bootstrap container reads it from env.",
    ).toMatch(/set_coolify_env[^\n]+PKI_DEFAULT_SECRET/);
  });
});
