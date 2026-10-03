/**
 * Gate: every WEBHOOK_* route var the event-worker reads must be PLUMBED into the
 * event-worker's compose environment block.
 * ===========================================================================
 *
 * The failure this locks out (the dormant-executor activation gap):
 *   services/event-worker/src/config.ts builds a webhookRoutes map keyed by
 *   `process.env['WEBHOOK_<X>']`. For a route to be activatable from Coolify env
 *   ALONE, the corresponding `WEBHOOK_<X>: ${WEBHOOK_<X>:-}` line must exist in the
 *   event-worker service block of docker-compose.coolify-realtime.yml — otherwise
 *   setting the var in Coolify never reaches the container and the route can never
 *   fire (observed: WEBHOOK_AGENT_RUNNER + WEBHOOK_PLAYWRIGHT_RUNNER were read by
 *   config.ts but absent from compose, so the event-primary wake half of the
 *   claude_cli_task / playwright executor axes was unactivatable — the documented
 *   "just set the env" recipe was a no-op).
 *
 * This is intentionally about REACHABILITY (empty-safe default off), not about
 * enabling anything: the compose value defaults empty so the axes stay dormant.
 * The gate only asserts the plumbing EXISTS, so a NEW event route added to
 * config.ts without the matching compose line fails here instead of silently in
 * production.
 *
 * Runs offline in `npm run test:gates`.
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const CONFIG = join(ROOT, "services/event-worker/src/config.ts");
const COMPOSE = join(ROOT, "docker-compose.coolify-realtime.yml");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

/** Every WEBHOOK_* env key the event-worker route table reads. */
function webhookEnvKeys(configSrc: string): string[] {
  const keys = new Set<string>();
  for (const m of configSrc.matchAll(/process\.env\[['"](WEBHOOK_[A-Z0-9_]+)['"]\]/g)) {
    keys.add(m[1]);
  }
  return [...keys].sort();
}

/**
 * The event-worker service's own environment block in the compose file. We scope to
 * that service so a WEBHOOK_* line under a different service would not false-green.
 */
function eventWorkerEnvBlock(composeSrc: string): string {
  const svc = composeSrc.indexOf("event-worker:");
  expect(svc, "event-worker service not found in realtime compose").toBeGreaterThan(-1);
  const envIdx = composeSrc.indexOf("environment:", svc);
  expect(envIdx, "event-worker environment block not found").toBeGreaterThan(svc);
  // env block runs until the next top-level service key or a sibling 2-space key
  // (volumes:/networks:/healthcheck:) — slice a generous window and stop at the
  // first line that dedents to 4 spaces + a key that is not an env var.
  const after = composeSrc.slice(envIdx);
  const stop = after.search(/\n {4}(volumes|networks|healthcheck|depends_on|labels|restart|image|build):/);
  return stop > -1 ? after.slice(0, stop) : after;
}

describe("event-worker webhook plumbing gate", () => {
  const configSrc = read(CONFIG);
  const composeSrc = read(COMPOSE);
  const keys = webhookEnvKeys(configSrc);
  const envBlock = eventWorkerEnvBlock(composeSrc);

  test("config.ts declares at least the known webhook routes", () => {
    // sanity: the scan finds the route table (guards against a config refactor
    // silently emptying this gate)
    expect(keys).toContain("WEBHOOK_AGENT_RUNNER");
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  test.each(keys.map((k) => [k] as [string]))(
    "%s is plumbed (empty-safe) in the event-worker compose env block",
    (key: string) => {
      // accept `WEBHOOK_X: ${WEBHOOK_X:-}` (empty-safe) — the value MUST default empty
      // so the route stays dormant unless the operator sets it.
      const re = new RegExp(`\\n\\s*${key}:\\s*\\$\\{${key}:-[^}]*\\}`);
      expect(
        re.test(envBlock),
        `${key} is read by event-worker/src/config.ts but not plumbed as ` +
          `\`${key}: \${${key}:-}\` in the event-worker environment block of ` +
          `docker-compose.coolify-realtime.yml — a Coolify env var for it can never ` +
          `reach the container. Add the empty-safe line (keeps the route dormant by default).`,
      ).toBe(true);
    },
  );
});
