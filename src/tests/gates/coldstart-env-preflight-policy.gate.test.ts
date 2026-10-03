/**
 * Cold-start env-preflight policy — sub-scripts must not out-strict their caller
 *
 * WHY (incident 2026-07-17, Phase D stranded):
 *   aisha-cold-start.sh calls coolify-sync-envs.sh with SKIP_ENV_PREFLIGHT=1 and
 *   documents exactly why: the heal pass has already written every derivable value,
 *   and `external`-classified secrets (N8N_API_KEY, RESEND_API_KEY, TELEGRAM_*,
 *   COSMOS_SIGNER_MNEMONIC, …) CANNOT be auto-generated — on a fresh instance they
 *   are legitimately absent until an operator supplies them.
 *
 *   netbird-bootstrap.sh — which the cold-start invokes — called the same
 *   coolify-sync-envs.sh WITHOUT that flag. So the strict preflight ran, found
 *   N8N_API_KEY empty (it is empty in prod too: an n8n API key can only be minted
 *   from inside an already-running n8n) and aborted. The abort landed AFTER the
 *   NetBird setup keys had already been regenerated, so Phase D died half-applied
 *   and every downstream wave (exec, integration, ledger, messaging, monitoring,
 *   observability-stack) never deployed.
 *
 *   The bug is not the missing key — it is TWO PATHS TO ONE SCRIPT WITH TWO
 *   POLICIES. A sub-script invoked by the cold-start must not enforce a stricter
 *   env contract than the cold-start itself, or a key the caller knowingly
 *   tolerates becomes a fatal abort deep inside a half-finished phase.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const NETBIRD_BOOTSTRAP = join(ROOT, "scripts/netbird-bootstrap.sh");
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");

describe("Cold-start env-preflight policy — one policy per script", () => {
  const bootstrap = readFileSync(NETBIRD_BOOTSTRAP, "utf-8");
  const coldStart = readFileSync(COLD_START, "utf-8");

  test("the cold-start itself skips the strict preflight (the policy this gate propagates)", () => {
    // Anchor the invariant on the caller: if the cold-start ever stops skipping the
    // preflight, this gate's premise changes and it must be revisited deliberately.
    expect(
      coldStart,
      "aisha-cold-start.sh is expected to call coolify-sync-envs.sh with SKIP_ENV_PREFLIGHT=1 (external secrets cannot be auto-generated).",
    ).toMatch(/SKIP_ENV_PREFLIGHT=1\s+bash\s+"?\$\{?REPO_ROOT\}?"?\/scripts\/coolify-sync-envs\.sh/);
  });

  test("every coolify-sync-envs.sh call in netbird-bootstrap carries SKIP_ENV_PREFLIGHT=1", () => {
    // Grab each invocation line and assert the flag is present on it.
    const calls = bootstrap
      .split(/\r?\n/)
      .filter((line) => /coolify-sync-envs\.sh/.test(line) && !line.trim().startsWith("#"));

    expect(calls.length, "expected netbird-bootstrap to invoke coolify-sync-envs.sh").toBeGreaterThan(0);

    for (const call of calls) {
      expect(
        call,
        "netbird-bootstrap must not apply a STRICTER env policy than the cold-start that invokes it — " +
          "a legitimately-absent `external` key (e.g. N8N_API_KEY) would abort the self-heal redeploy " +
          "AFTER setup keys were regenerated, stranding Phase D and all downstream waves:\n" +
          call.trim(),
      ).toMatch(/SKIP_ENV_PREFLIGHT=1/);
    }
  });
});
