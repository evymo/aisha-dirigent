/**
 * PKI Trust Bundle Fail-Closed Gate
 *
 * OWNS: the RUNTIME BEHAVIOUR of infra/pki/assemble-ca-bundle.sh.
 *
 * This gate does not grep the script — it EXECUTES it against a fake pki-bridge
 * and asserts what actually happens. A spelling check would have passed the
 * broken version too: the old script "handled" an unreachable bridge, it just
 * handled it by writing a bundle that could never work.
 *
 * ── THE PROPERTY ──────────────────────────────────────────────────────────────
 * A mesh peer gets the LIVE realm CA or it FAILS. No third outcome.
 *
 * ── WHY (measured 2026-07-19) ─────────────────────────────────────────────────
 * The realm CAs are generated at first boot by pki-realm-bootstrap.sh from a
 * random EC keypair. The committed config/pki/aisha-ca-bundle.pem froze on
 * 2026-04-13, so it cannot match the CA signing mesh TLS on ANY live instance.
 * The old script fell back to it on any failure and exited 0, which produced the
 * worst available outcome: every container healthy, every mesh TLS handshake
 * dead with `x509: ECDSA verification failure`, api/mcp 502, and no log line
 * anywhere naming the trust bundle.
 *
 * Two independent triggers, both real:
 *   1. RACE — aisha-redeploy.mjs wave 2 starts aisha-core, aisha-pki and
 *      aisha-edge together, and pki-bridge lives inside aisha-pki. One 15s
 *      attempt loses that race.
 *   2. EMPTY-BUT-OK — pki-bridge answers 200 with an EMPTY body while OpenXPKI
 *      bootstraps the realms (its own contract in svc-pki-bridge/src/server.ts
 *      says "consumer should retry"). The old check was `[ -s "$tmp" ]`, so a
 *      SUCCESSFUL request during bootstrap also fell back.
 * Hence the readiness signal asserted here is "the body contains a certificate",
 * never "the request worked".
 *
 * Consumers wire `condition: service_completed_successfully`, so a non-zero exit
 * stops the stack loudly instead of booting permanently broken trust — the last
 * test pins that wiring, because fail-closed is worthless if nobody waits.
 *
 * Spousti se pres: npm run test:gates
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "infra/pki/assemble-ca-bundle.sh");

/** A syntactically real PEM block — the script keys off the BEGIN marker. */
const FAKE_REALM_CA = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBfakeRealmCertificateBodyForGateTestingOnly",
  "-----END CERTIFICATE-----",
].join("\n");

const FAKE_SYSTEM_ROOTS = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBfakePublicRootForGateTestingOnly",
  "-----END CERTIFICATE-----",
].join("\n");

/**
 * Fake pki-bridge — in a SEPARATE PROCESS, deliberately.
 *
 * The script under test is invoked with execFileSync, which blocks this thread
 * until it returns. An in-process http server could therefore never answer:
 * curl would hang, every request would time out, and the gate would "prove"
 * failures that are artefacts of its own harness. (Observed while writing this
 * gate — three tests failed against a script that was fine.)
 *
 * Mode + hit count live in files so the parent can steer the child and read
 * back how many attempts the script actually made.
 */
let child: ReturnType<typeof spawn>;
let port = 0;
let tmp = "";
let modeFile = "";
let hitsFile = "";

function setMode(m: "empty" | "cert" | "empty-then-cert"): void {
  writeFileSync(modeFile, m);
  writeFileSync(hitsFile, "0");
}

function getHits(): number {
  return Number.parseInt(readFileSync(hitsFile, "utf-8").trim() || "0", 10);
}

const BRIDGE_SRC = `
const http = require("node:http");
const fs = require("node:fs");
// NOTE: with \`node -e\`, user args start at argv[1] — there is no script path to
// skip. slice(2) silently drops modeFile, which made the server write to a path
// that was actually the PEM body, crash on the first request, and present as
// "connection refused" with zero hits.
const [modeFile, hitsFile, cert] = process.argv.slice(1);
http.createServer((req, res) => {
  if (!req.url.startsWith("/diag/ca-bundle")) { res.writeHead(404).end(); return; }
  const hits = Number(fs.readFileSync(hitsFile, "utf8").trim() || "0") + 1;
  fs.writeFileSync(hitsFile, String(hits));
  const mode = fs.readFileSync(modeFile, "utf8").trim();
  const serveCert = mode === "cert" || (mode === "empty-then-cert" && hits > 2);
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(serveCert ? cert : "");            // bootstrap case: 200 + EMPTY body
}).listen(0, "127.0.0.1", function () { console.log("PORT=" + this.address().port); });
`;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "pki-bundle-gate-"));
  modeFile = join(tmp, "mode");
  hitsFile = join(tmp, "hits");
  setMode("empty");

  child = spawn(process.execPath, ["-e", BRIDGE_SRC, modeFile, hitsFile, FAKE_REALM_CA], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fake pki-bridge did not start")), 10_000);
    child.stdout?.on("data", (buf: Buffer) => {
      const m = buf.toString().match(/PORT=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
  });
});

afterAll(() => {
  child?.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

interface RunResult {
  status: number;
  stderr: string;
  stdout: string;
  out: string | null;
  certCount: number;
}

/** execFileSync throws on non-zero exit, and several cases here EXPECT that — capture it. */
function runCapture(env: Record<string, string>, label: string): RunResult {
  const outPath = join(tmp, `bundle-${label}.pem`);
  const systemCa = join(tmp, `system-${label}.crt`);
  writeFileSync(systemCa, `${FAKE_SYSTEM_ROOTS}\n`);

  // spawnSync, NOT execFileSync: the latter only surfaces stderr via the thrown
  // error, so a run that exits 0 loses it entirely. That silently blinded the
  // PKI_BUNDLE_REQUIRED=false case — exit 0 is precisely where the script must
  // still be LOUD, and the harness could not see the message it had to assert.
  const proc = spawnSync("sh", [SCRIPT], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      CA_BUNDLE_OUT: outPath,
      SYSTEM_CA_BUNDLE: systemCa,
      ...env,
    },
  });
  const status = proc.status ?? 1;
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";

  const out = existsSync(outPath) ? readFileSync(outPath, "utf-8") : null;
  const certCount = out ? (out.match(/BEGIN CERTIFICATE/g) ?? []).length : 0;
  return { status, stderr, stdout, out, certCount };
}

describe("PKI trust bundle — live CA or fail closed", () => {
  test("PKI_BRIDGE_URL unset ⇒ public roots only, exit 0 (legitimate non-mesh deployment)", () => {
    const r = runCapture({ PKI_BRIDGE_URL: "" }, "unset");
    expect(r.status, r.stderr).toBe(0);
    expect(r.certCount, "only the system roots belong in the bundle").toBe(1);
    expect(r.out, "the stale baked CA must not be appended").not.toContain("fakeRealmCertificate");
  });

  test("bridge answers 200 with an EMPTY body ⇒ retries, then FAILS (never the baked bundle)", () => {
    setMode("empty");
    const r = runCapture(
      {
        PKI_BRIDGE_URL: `http://127.0.0.1:${port}`,
        // The deadline must outlast ONE slow attempt by a wide margin, or a
        // loaded machine burns the whole window on attempt 1 and the loop exits
        // having "given up after one attempt" — the very thing this asserts.
        // 12s vs a 2s attempt + 1s delay leaves room for a 4x slowdown.
        PKI_BUNDLE_WAIT_S: "12",
        PKI_BUNDLE_RETRY_DELAY_S: "1",
        PKI_BUNDLE_ATTEMPT_TIMEOUT_S: "2",
      },
      "empty",
    );
    expect(r.status, "an empty bundle must not be accepted as success").toBe(1);
    // Assert the PROPERTY (the baked bundle was not used), not the wording.
    expect(r.stderr, "must state that the baked copy was not used").toMatch(/baked[\s\S]{0,40}NOT used/i);
    expect(r.stderr, "must name the consequence so an operator can act").toMatch(/NO LIVE REALM CA/i);
    expect(getHits(), "must retry rather than give up after one attempt").toBeGreaterThan(1);
    expect(r.certCount, "no realm CA may be written on failure").toBe(1);
  });

  test("bridge unreachable ⇒ FAILS", () => {
    const r = runCapture(
      {
        // Port 9 (discard) — refuses immediately.
        PKI_BRIDGE_URL: "http://127.0.0.1:9",
        PKI_BUNDLE_WAIT_S: "3",
        PKI_BUNDLE_RETRY_DELAY_S: "1",
        PKI_BUNDLE_ATTEMPT_TIMEOUT_S: "1",
      },
      "unreachable",
    );
    expect(r.status).toBe(1);
    // Assert the PROPERTY (the baked bundle was not used), not the wording.
    expect(r.stderr, "must state that the baked copy was not used").toMatch(/baked[\s\S]{0,40}NOT used/i);
    expect(r.stderr, "must name the consequence so an operator can act").toMatch(/NO LIVE REALM CA/i);
  });

  test("bridge serves a real CA ⇒ exit 0 with system roots AND the realm CA", () => {
    setMode("cert");
    const r = runCapture(
      { PKI_BRIDGE_URL: `http://127.0.0.1:${port}`, PKI_BUNDLE_WAIT_S: "10" },
      "cert",
    );
    expect(r.status, r.stderr).toBe(0);
    // SSL_CERT_FILE REPLACES Go's trust pool, so dropping the public roots here
    // would leave an EMPTY pool rather than falling back to the system store.
    expect(r.out, "public roots must survive").toContain("fakePublicRoot");
    expect(r.out, "live realm CA must be appended").toContain("fakeRealmCertificate");
    expect(r.certCount).toBe(2);
  });

  test("empty twice then a real CA ⇒ the retry RECOVERS (the cold-start race)", () => {
    setMode("empty-then-cert");
    const r = runCapture(
      {
        PKI_BRIDGE_URL: `http://127.0.0.1:${port}`,
        PKI_BUNDLE_WAIT_S: "20",
        PKI_BUNDLE_RETRY_DELAY_S: "1",
      },
      "recover",
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.certCount, "recovered bundle must carry both certs").toBe(2);
    expect(getHits(), "should have taken more than one attempt").toBeGreaterThan(2);
  });

  /**
   * 2026-08-01 — this test used to be
   *
   *   if (!content.includes("service_completed_successfully")) missing.push(file)
   *
   * a substring search over the WHOLE FILE. Every compose here contains that
   * string somewhere (other services use it too), so the test passed for
   * docker-compose.coolify.yml at a time when NOTHING in that file gated on
   * pki-init at all. It certified the very guarantee it was written to prove.
   *
   * Now it resolves the actual edge: find the service that runs
   * assemble-ca-bundle.sh, then find a service whose `depends_on` names THAT
   * service with `condition: service_completed_successfully`.
   */
  test("fail-closed is only useful if consumers WAIT — resolve the real depends_on edge", () => {
    const consumers = [
      "docker-compose.coolify.yml",
      "docker-compose.coolify-prebuilt.yml",
      "docker-compose.coolify-integration.yml",
      "docker-compose.coolify-cosmos.yml",
      "docker-compose.coolify-local-ingest.yml",
      "docker-compose.coolify-potok.yml",
    ];
    const missing: string[] = [];
    const checked: string[] = [];

    for (const file of consumers) {
      const path = join(ROOT, file);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf-8");
      if (!content.includes("assemble-ca-bundle.sh")) continue;

      const lines = content.split("\n");

      // 1. Which service runs the assembler? Track the most recent top-level
      //    (2-space indented) service key above the command line.
      let initService: string | null = null;
      let current: string | null = null;
      for (const line of lines) {
        const svc = line.match(/^ {2}([a-z0-9][a-z0-9._-]*):\s*$/i);
        if (svc) current = svc[1];
        if (line.includes("assemble-ca-bundle.sh") && current) {
          initService = current;
          break;
        }
      }
      if (!initService) {
        missing.push(`${file}: could not resolve which service runs the assembler`);
        continue;
      }

      // 2. Does any service depend on it with service_completed_successfully?
      //    Shape:  depends_on:\n      <initService>:\n        condition: service_completed_successfully
      const gated = new RegExp(
        `depends_on:[\\s\\S]{0,400}?^\\s+${initService.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}:\\s*$\\n\\s+condition:\\s*service_completed_successfully`,
        "m",
      ).test(content);

      if (gated) checked.push(`${file} (${initService})`);
      else missing.push(`${file}: '${initService}' runs the assembler but no service gates on its completion`);
    }

    expect(checked.length, "no consumer was actually resolved — the parser regressed").toBeGreaterThan(0);
    expect(
      missing,
      "these stacks run assemble-ca-bundle.sh but let dependents start regardless — " +
        "a failed trust assembly would be silently ignored:\n" + missing.join("\n"),
    ).toEqual([]);
  });

  /**
   * PKI_BUNDLE_REQUIRED / PKI_BUNDLE_WAIT_S must be REACHABLE from the compose
   * env, or the script's own remediation advice is inoperable. The previous
   * revision told operators to "raise PKI_BUNDLE_WAIT_S" while the variable
   * appeared ZERO times outside the script — no compose passed it, so setting
   * it anywhere had no effect.
   */
  test("the tuning knobs the script names are actually plumbed through compose", () => {
    const consumers = [
      "docker-compose.coolify.yml",
      "docker-compose.coolify-prebuilt.yml",
      "docker-compose.coolify-integration.yml",
      "docker-compose.coolify-cosmos.yml",
      "docker-compose.coolify-local-ingest.yml",
      "docker-compose.coolify-potok.yml",
    ];
    const unplumbed: string[] = [];
    for (const file of consumers) {
      const path = join(ROOT, file);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf-8");
      if (!content.includes("assemble-ca-bundle.sh")) continue;
      for (const knob of ["PKI_BUNDLE_WAIT_S", "PKI_BUNDLE_REQUIRED"]) {
        if (!content.includes(knob)) unplumbed.push(`${file}: ${knob}`);
      }
    }
    expect(
      unplumbed,
      "the script documents these as tunable, but they never reach the container:\n" +
        unplumbed.join("\n"),
    ).toEqual([]);
  });

  /**
   * The deadline must sit under the timeout that ACTUALLY applies to the wave
   * this runs in. Phase A (waves 1-3, which carry every pki-init consumer) uses
   * AISHA_PHASE_A_WAVE_TIMEOUT_S, not the steady-state AISHA_WAVE_TIMEOUT_S an
   * earlier revision cited — it gave up ~14x earlier than the orchestrator
   * would have tolerated, and the header said so in writing.
   */
  test("the default deadline is derived from the timeout that really applies", () => {
    const src = readFileSync(SCRIPT, "utf-8");
    const m = src.match(/PKI_BUNDLE_WAIT_S:-(\d+)/);
    expect(m, "PKI_BUNDLE_WAIT_S must have a numeric default").not.toBeNull();
    const wait = Number(m![1]);

    const timeouts = readFileSync(join(ROOT, "config/cold-start-timeouts.env"), "utf-8");
    const pa = timeouts.match(/AISHA_PHASE_A_WAVE_TIMEOUT_S=(\d+)/);
    expect(pa, "config/cold-start-timeouts.env must declare AISHA_PHASE_A_WAVE_TIMEOUT_S").not.toBeNull();
    const phaseA = Number(pa![1]);

    expect(wait, `deadline ${wait}s must be below the phase-A wave timeout ${phaseA}s`).toBeLessThan(phaseA);
    expect(
      wait,
      `deadline ${wait}s is far below ${phaseA}s — the pki-db(60s)+pki-server(180s) bootstrap chain needs the room`,
    ).toBeGreaterThanOrEqual(Math.floor(phaseA * 0.6));
  });

  /**
   * PKI_BUNDLE_REQUIRED=false — the per-stack policy edge uses.
   *
   * Fail-closed on a WAVE-2 CRITICAL app halts the cold start before Keycloak
   * (wave 3) deploys, so edge opts out. It must still refuse the baked bundle
   * and still say so loudly — the opt-out changes the EXIT CODE, nothing else.
   */
  test("PKI_BUNDLE_REQUIRED=false ⇒ truthful bundle + marker + exit 0 (no baked CA)", () => {
    setMode("empty");
    const r = runCapture(
      {
        PKI_BRIDGE_URL: `http://127.0.0.1:${port}`,
        PKI_BUNDLE_REQUIRED: "false",
        PKI_BUNDLE_WAIT_S: "4",
        PKI_BUNDLE_RETRY_DELAY_S: "1",
        PKI_BUNDLE_ATTEMPT_TIMEOUT_S: "2",
      },
      "notrequired",
    );
    expect(r.status, "opting out must not fail the container").toBe(0);
    expect(r.certCount, "public roots only — no realm CA, and definitely not the baked one").toBe(1);
    expect(r.out, "the stale baked CA must never appear").not.toContain("fakeRealmCertificate");
    expect(r.stderr, "the failure must still be loud").toMatch(/NO LIVE REALM CA/i);
    expect(r.stderr, "must name the policy that kept it alive").toMatch(/PKI_BUNDLE_REQUIRED=false/);
  });

  /**
   * NEVER LEAVE THE VOLUME WORSE THAN FOUND.
   *
   * The previous revision ran `cp "$SYSTEM_CA" "$OUT"` unconditionally BEFORE
   * the retry loop, so a timeout DESTROYED a good bundle already in the
   * persisted volume. That hit hardest exactly where recovery was designed to
   * happen: the wave-5 edge re-deploy, whose volume already held a working
   * bundle from wave 2.
   */
  test("an existing bundle WITH a realm CA survives a failed run", () => {
    setMode("empty");
    const outPath = join(tmp, "bundle-preserve.pem");
    const systemCa = join(tmp, "system-preserve.crt");
    writeFileSync(systemCa, `${FAKE_SYSTEM_ROOTS}\n`);
    // Pre-existing GOOD bundle: system roots + a realm CA (2 certs).
    writeFileSync(outPath, `${FAKE_SYSTEM_ROOTS}\n${FAKE_REALM_CA}\n`);

    let status = 0;
    let stderr = "";
    try {
      execFileSync("sh", [SCRIPT], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          CA_BUNDLE_OUT: outPath,
          SYSTEM_CA_BUNDLE: systemCa,
          PKI_BRIDGE_URL: `http://127.0.0.1:${port}`,
          PKI_BUNDLE_WAIT_S: "4",
          PKI_BUNDLE_RETRY_DELAY_S: "1",
          PKI_BUNDLE_ATTEMPT_TIMEOUT_S: "2",
        },
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      status = e.status ?? 1;
      stderr = e.stderr ?? "";
    }

    const after = readFileSync(outPath, "utf-8");
    expect(status, "still fails closed by default").toBe(1);
    expect(
      (after.match(/BEGIN CERTIFICATE/g) ?? []).length,
      "the pre-existing realm CA must NOT be deleted by a failed run",
    ).toBe(2);
    expect(after, "the realm CA specifically must survive").toContain("fakeRealmCertificate");
    expect(stderr, "and it must say it kept it").toMatch(/keeping the existing bundle/i);
  });

  /** A successful run replaces the output atomically — no partial bundle. */
  test("a successful fetch leaves system roots AND realm CA, and clears the marker", () => {
    setMode("cert");
    const outPath = join(tmp, "bundle-marker.pem");
    const systemCa = join(tmp, "system-marker.crt");
    const marker = join(tmp, ".no-realm-ca");
    writeFileSync(systemCa, `${FAKE_SYSTEM_ROOTS}\n`);
    writeFileSync(marker, "");

    execFileSync("sh", [SCRIPT], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        CA_BUNDLE_OUT: outPath,
        SYSTEM_CA_BUNDLE: systemCa,
        PKI_BRIDGE_URL: `http://127.0.0.1:${port}`,
        PKI_BUNDLE_WAIT_S: "10",
      },
    });

    const out = readFileSync(outPath, "utf-8");
    expect(out).toContain("fakePublicRoot");
    expect(out).toContain("fakeRealmCertificate");
    expect(existsSync(marker), "the marker must be cleared once trust is real").toBe(false);
  });

  test("the script does not reintroduce a baked-bundle fallback path", () => {
    const src = readFileSync(SCRIPT, "utf-8");
    const active = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    // Prose in the header explains the removal; executable lines must not restore it.
    expect(
      /cat\s+"?\$?\{?STAGING/.test(active) || /\/staging\/aisha-ca-bundle/.test(active),
      "an executable line appends the baked bundle again — see this gate's header for why that " +
        "trust anchor can never match a live instance",
    ).toBe(false);
  });
});
