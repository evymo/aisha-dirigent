/**
 * Gate: long-running service containers whose PID 1 does NOT reap children must
 * run an init reaper (`init: true` → docker injects tini) when they also spawn
 * short-lived child processes periodically — otherwise defunct (zombie) children
 * accumulate and exhaust the HOST process table, making fork() fail host-wide.
 *
 * Incident 2026-06-13 (talos host): two containers leaked ~31.6k zombies:
 *   - mesh-router (netbird agent; in idle mode PID 1 is a bare `sleep infinity`
 *     that never wait()s) → ~28.8k defunct `timeout` helpers from its
 *     enrollment/health loop re-parented to PID 1 and piled up.
 *   - netbird-internal-tls (bare caddy PID 1) → ~2.8k defunct `ssl_client`
 *     children spawned by its busybox `wget --no-check-certificate https://…`
 *     healthcheck.
 * The host process table filled (32k procs) → fork() returned EAGAIN host-wide →
 * mesh-router's OWN healthcheck could no longer fork a shell → it reported
 * unhealthy → aisha-edge flapped `running:unhealthy`. The service was fine; the
 * host was starved. `init: true` (tini as PID 1) reaps children so zombies can
 * never accumulate.
 *
 * Two layers, because the leak source differs:
 *  (1) GENERALIZED — any service whose container healthcheck probe spawns a
 *      TLS/`timeout` child over loopback (the busybox `wget --no-check-certificate
 *      https://…` / `timeout …` signature that re-parents zombies) must set
 *      `init: true`. Catches netbird-internal-tls and any future look-alike.
 *  (2) REGRESSION LOCK — services proven to leak from a NON-healthcheck source
 *      (mesh-router's entrypoint loop, whose docker healthcheck is only `pgrep`)
 *      are asserted explicitly, since a healthcheck-signature heuristic cannot
 *      see an entrypoint-driven leak.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const composeFiles = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f));

interface Svc {
  file: string;
  name: string;
  body: string;
}

// Split a compose into service blocks. Services are keyed at exactly 2-space
// indent (`  name:`); any 0-indent key (networks:, volumes:, x-anchors, top-level
// `services:`) ends the current block. Comments are kept in the body (harmless).
function services(file: string): Svc[] {
  const lines = readFileSync(join(ROOT, file), "utf-8").split("\n");
  const out: Svc[] = [];
  let cur: Svc | null = null;
  for (const line of lines) {
    const m = line.match(/^ {2}([a-z][a-z0-9_-]*):\s*$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { file, name: m[1], body: "" };
      continue;
    }
    if (/^[A-Za-z]/.test(line)) {
      // a 0-indent key closes the services region for this block
      if (cur) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    if (cur) cur.body += line + "\n";
  }
  if (cur) out.push(cur);
  return out;
}

const allSvcs = composeFiles.flatMap(services);

const hasInit = (s: Svc): boolean => /^\s*init:\s*true\s*$/m.test(s.body);
const healthcheckTest = (s: Svc): string => {
  const m = s.body.match(/^\s*test:.*$/m);
  return m ? m[0] : "";
};
// The zombie-leaking probe signature: a TLS handshake over loopback (busybox
// wget/curl spawns an `ssl_client` helper child) or a `timeout`-wrapped probe.
// Deliberately NOT matching plain `http://localhost/health` — those probes do
// not fork a persistent helper, so they don't leak under a non-reaping PID 1.
const LEAKY_PROBE = /--no-check-certificate|https:\/\/(127\.0\.0\.1|localhost)|(?:^|\s)timeout\s/;

// Services proven to leak from a source a healthcheck heuristic can't detect.
const REGRESSION_LOCK = ["mesh-router", "netbird-internal-tls"];

describe("Container init/zombie reaper", () => {
  test("scanner found the coolify composes (sanity)", () => {
    expect(composeFiles.length).toBeGreaterThan(0);
    expect(allSvcs.length).toBeGreaterThan(0);
  });

  test("services with a TLS/timeout healthcheck probe set `init: true` (zombie reaper)", () => {
    const offenders = allSvcs
      .filter((s) => LEAKY_PROBE.test(healthcheckTest(s)))
      .filter((s) => !hasInit(s))
      .map((s) => `  ${s.file} → ${s.name}: healthcheck spawns a TLS/timeout child but service has no \`init: true\``);
    expect(
      offenders,
      `Containers leak zombies without an init reaper (host fork() exhaustion, incident 2026-06-13):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("known zombie-leaking services keep `init: true` (regression lock)", () => {
    const missing: string[] = [];
    for (const name of REGRESSION_LOCK) {
      const matches = allSvcs.filter((s) => s.name === name);
      if (matches.length === 0) continue; // service removed/renamed → leak source gone
      for (const s of matches) {
        if (!hasInit(s)) missing.push(`  ${s.file} → ${name}: must keep \`init: true\` (proven zombie leaker, incident 2026-06-13)`);
      }
    }
    expect(missing, `Regression: a known zombie-leaking service dropped its init reaper:\n${missing.join("\n")}`).toEqual([]);
  });

  test("mesh-router is present and reaped (the incident's primary leaker)", () => {
    const mr = allSvcs.filter((s) => s.name === "mesh-router");
    expect(mr.length, "mesh-router service not found in any coolify compose").toBeGreaterThan(0);
    for (const s of mr) expect(hasInit(s), `${s.file} → mesh-router must set \`init: true\``).toBe(true);
  });
});
