import { config } from '../config.js';

/**
 * Defence-in-depth container-image admission.
 *
 * The operator-role auth boundary (`requireRunnerOperator`) is the PRIMARY
 * blast-radius gate — only `service_role` / `admin` / `staff` reach the /runs
 * routes, and the service is topology-internal (not edge-exposed). This OPT-IN
 * allowlist adds a second, least-privilege barrier: a hardened deployment can
 * pin the images the runner will launch to trusted registry/repo PREFIXES, so a
 * compromised operator or the broadly-held service-role token cannot spawn an
 * arbitrary image that exfiltrates the run's injected secrets (BROKER_TOKEN,
 * CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, AGENT_GIT_TOKEN, …).
 *
 * Enforced at the backend SINK (every `containers/create` path), NOT the HTTP
 * route, so BOTH producers are covered by one check: `POST /runs` and the DB
 * poller (`poller.ts`) that claims queued `claude_cli_task` rows.
 *
 * `AGENT_IMAGE_ALLOWLIST` is a comma-separated list of allowed image PREFIXES.
 * Empty (the default) ⇒ no restriction — byte-for-byte the prior behaviour where
 * "the auth boundary is the only filter". Rejection is fail-loud (no fallback):
 * the run fails with a clear error rather than silently downgrading.
 */
export function assertImageAllowed(image: string): void {
  const prefixes = config.agentImageAllowlist
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (prefixes.length === 0) return; // opt-in: unset ⇒ unrestricted (unchanged default)
  if (!prefixes.some((prefix) => image.startsWith(prefix))) {
    throw new Error(
      `Image '${image}' is not permitted by AGENT_IMAGE_ALLOWLIST (allowed prefixes: ${prefixes.join(', ')})`,
    );
  }
}
