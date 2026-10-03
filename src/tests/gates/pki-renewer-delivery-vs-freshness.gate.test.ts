/**
 * Gate: pki-renewer must never treat "I have a fresh copy" as "the consumer got one".
 *
 * WHY THIS EXISTS (incident 2026-07-20, TENANT mesh down ~20h)
 * --------------------------------------------------------
 * process_service() has two freshness gates in sequence:
 *   1. current_cert_pem()               — asks the CONSUMER (Coolify env)
 *   2. file_cert_valid_beyond_threshold — asks THIS container's own volume
 *
 * Gate 2 used to `return 0`. That let the SECOND gate veto the FIRST: gate 1 had
 * just proven the consumer holds no cert, and gate 2 answered "but I have a
 * copy" and returned, delivering nothing by either path.
 *
 * The premise behind gate 2 was that `pki-certs` is one shared volume. It is not.
 * Coolify names volumes per application UUID and every stack declares its own
 * `name: aisha_<stack>-pki-certs`, so the renewer's /certs/pki and
 * netbird-internal-tls's /ca are different disks wearing the same name. Measured
 * on tenant: renewer had a valid cert, the consumer's directory was empty,
 * netbird-internal-tls fell back to self-signed, and every netbird agent failed
 * TLS against management, signal and relay.
 *
 * WHAT THESE TESTS ASSERT, AND WHY THAT SHAPE
 * -------------------------------------------
 * They drive the real shell function against stubbed collaborators and check the
 * PAYLOAD, not the call. An earlier revision of this gate recorded only the env
 * KEY NAME that patch_env was called with — so it would have passed while an
 * EMPTY cert was delivered, which is the incident's exact symptom. Asserting
 * "the envelope was addressed" instead of "something was in it" is the same
 * green-probe-over-nothing failure the fix exists to prevent.
 *
 * Delivery here means all three of: a non-empty, decodable cert reached the
 * consumer; its key MATCHES it; and the consumer was restarted so it reloads.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const RENEWER = join(ROOT, "infra/pki/pki-renewer.sh");

let workdir: string;
let pairA: { cert: string; key: string };
let pairB: { cert: string; key: string };
/** Same directory slug (netbird.*), but issued for a DIFFERENT FQDN. */
let pairStale: { cert: string; key: string };

/** A real cert is required: the script gates on `openssl x509 -checkend`. */
function makeCert(dir: string, tag: string, days: number, cn = "netbird.mesh.test.internal"): { cert: string; key: string } {
  const cert = join(dir, `${tag}-cert.pem`);
  const key = join(dir, `${tag}-key.pem`);
  const r = spawnSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
     "-keyout", key, "-out", cert, "-days", String(days),
     "-subj", `/CN=${cn}`],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
  return { cert: readFileSync(cert, "utf-8"), key: readFileSync(key, "utf-8") };
}

/** Public key of a cert / of a private key — equal iff the pair belongs together. */
function pubOf(pem: string, kind: "cert" | "key"): string {
  const args = kind === "cert" ? ["x509", "-noout", "-pubkey"] : ["pkey", "-pubout"];
  const r = spawnSync("openssl", args, { input: pem, encoding: "utf-8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

type Run = {
  stdout: string;
  rc: string | null;
  /** env key -> delivered VALUE (already base64-decoded), for what was patched */
  delivered: Record<string, string>;
  restarted: boolean;
  issued: boolean;
};

/**
 * Sources the script with the lib-only seam, replaces every outbound
 * collaborator with a recorder, then runs process_service once.
 *
 * consumerMode: "empty"   -> consumer holds nothing (gate 1 must not fire)
 *               "valid"   -> consumer already holds a good cert
 *               "unreadable" -> current_cert_pem is stubbed to fail: pins how the
 *                            CALLER handles an unknown consumer state
 *               "api-down"   -> current_cert_pem is NOT stubbed; the Coolify API
 *                            call inside it fails. Pins the PRODUCER side, i.e.
 *                            that the real function reports the failure instead
 *                            of returning an indistinguishable empty string.
 */
function runScenario(opts: {
  consumerMode: "empty" | "valid" | "unreadable" | "api-down";
  localCert: string | null;
  localKey?: string;
}): Run {
  const scen = mkdtempSync(join(workdir, "scen-"));
  const certsDir = join(scen, "certs");
  mkdirSync(join(certsDir, "netbird-mesh"), { recursive: true });

  if (opts.localCert !== null) {
    writeFileSync(join(certsDir, "netbird-mesh/cert.pem"), opts.localCert);
    writeFileSync(join(certsDir, "netbird-mesh/key.pem"), opts.localKey ?? pairA.key);
  }
  writeFileSync(join(scen, "consumer.pem"), opts.consumerMode === "valid" ? pairA.cert : "");

  // "api-down" deliberately leaves the REAL current_cert_pem in place so the
  // failure has to travel through it; the curl stub below breaks the /envs read.
  const consumerStub =
    opts.consumerMode === "unreadable"
      ? `current_cert_pem() { return 7; }`
      : opts.consumerMode === "api-down"
        ? `# current_cert_pem intentionally NOT stubbed`
        : `current_cert_pem() { cat "$SCEN/consumer.pem"; }`;

  const envsCurl =
    opts.consumerMode === "api-down"
      ? `    */envs*) return 22 ;;   # simulate a Coolify API failure (curl -f => 22)`
      : `    */envs*) printf '[]' ;;`;

  const harness = join(scen, "harness.sh");
  writeFileSync(
    harness,
    `#!/bin/sh
SCEN="${scen}"
export KEYCLOAK_URL=http://kc.invalid
export KEYCLOAK_REALM=test
export COOLIFY_API=http://coolify.invalid/api/v1
export COOLIFY_API_TOKEN=stub-token
export RENEW_SERVICES=netbird.mesh.test.internal
export PKI_ISSUER_CLIENT_SECRET=stub-secret
export PKI_CERTS_DIR="$SCEN/certs"
export APP_NAME_PREFIX=aisha

PKI_RENEWER_LIB_ONLY=1 . "${RENEWER}"

# --- stubs override the real definitions (defined after sourcing) -------------
app_uuid_by_name() { echo "uuid-netbird"; }
${consumerStub}
get_token()        { echo "stub-token"; }
# Record the VALUE, not just the key — a gate that only sees the key name would
# pass while an empty cert is delivered, i.e. the incident itself.
patch_env()        { printf '%s' "$3" > "$SCEN/delivered-$2"; echo 200; }
restart_app()      { echo restarted >> "$SCEN/restarted.log"; echo 200; }
persist_issued_cert(){ echo persist >> "$SCEN/persisted.log"; return 0; }
# Only a call to the issuance endpoint counts as an issuance; get_token also
# uses curl in the real script, so a blanket recorder would conflate the two.
curl() {
  case "$*" in
${envsCurl}
    */v1/issue*) echo ISSUED >> "$SCEN/issued.log"
                 printf '{"certificate":"x","privateKey":"y","certIdentifier":"z"}\\n200' ;;
    *) printf '' ;;
  esac
}

# set -e comes from the sourced script; without relaxing it a nonzero return
# would kill the harness before the rc is reported.
set +e
process_service netbird.mesh.test.internal
rc=$?
set -e
echo "PROCESS_RC=$rc"
`,
    { mode: 0o755 },
  );

  const r = spawnSync("sh", [harness], { encoding: "utf-8", timeout: 30_000 });
  const stdout = (r.stdout ?? "") + (r.stderr ?? "");

  const delivered: Record<string, string> = {};
  for (const k of ["NETBIRD_INTERNAL_CERT_B64", "NETBIRD_INTERNAL_KEY_B64"]) {
    const f = join(scen, `delivered-${k}`);
    if (existsSync(f)) {
      delivered[k] = Buffer.from(readFileSync(f, "utf-8"), "base64").toString("utf-8");
    }
  }
  const m = stdout.match(/PROCESS_RC=(\d+)/);
  return {
    stdout,
    rc: m ? m[1] : null,
    delivered,
    restarted: existsSync(join(scen, "restarted.log")),
    issued: existsSync(join(scen, "issued.log")),
  };
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "pki-renewer-gate-"));
  pairA = makeCert(workdir, "a", 365);
  pairB = makeCert(workdir, "b", 365);
  pairStale = makeCert(workdir, "stale", 365, "netbird.mesh.OLDTLD.internal");
});

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("pki-renewer: freshness of the local copy is not evidence of delivery", () => {
  test("script passes sh -n", () => {
    const r = spawnSync("sh", ["-n", RENEWER], { encoding: "utf-8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  test("lib-only seam sources without running the daemon loop", () => {
    const r = spawnSync(
      "sh",
      ["-c", `PKI_RENEWER_LIB_ONLY=1 . "${RENEWER}" && command -v process_service >/dev/null && echo LOADED`],
      {
        encoding: "utf-8",
        timeout: 15_000,
        env: {
          ...process.env,
          KEYCLOAK_URL: "http://kc.invalid",
          KEYCLOAK_REALM: "test",
          COOLIFY_API: "http://coolify.invalid/api/v1",
          COOLIFY_API_TOKEN: "stub",
          RENEW_SERVICES: "netbird.mesh.test.internal",
        },
      },
    );
    expect(r.stdout).toContain("LOADED");
  });

  /**
   * THE REGRESSION TEST. Local volume fresh, consumer empty.
   * Before the fix this returned 0 having delivered nothing.
   */
  test("consumer has NO cert but local volume does → delivers a REAL cert to the consumer", () => {
    const r = runScenario({ consumerMode: "empty", localCert: pairA.cert });

    expect(r.rc).toBe("0");
    // Not just "patch_env was called" — the payload must be a usable cert.
    const cert = r.delivered["NETBIRD_INTERNAL_CERT_B64"];
    const key = r.delivered["NETBIRD_INTERNAL_KEY_B64"];
    expect(cert).toBeTruthy();
    expect(key).toBeTruthy();
    expect(cert).toContain("BEGIN CERTIFICATE");
    expect(key).toMatch(/BEGIN (RSA )?PRIVATE KEY/);
    // ...and the two must actually belong together.
    expect(pubOf(cert, "cert")).toBe(pubOf(key, "key"));
  });

  /**
   * Delivery without a reload leaves the consumer serving the old cert, and the
   * consumer-freshness check then reads back our own write and skips forever.
   */
  test("...and restarts the consumer so it actually loads what was delivered", () => {
    const r = runScenario({ consumerMode: "empty", localCert: pairA.cert });
    expect(r.restarted).toBe(true);
  });

  /**
   * The reuse must not cost an issuance: every issue queues a revocation
   * (certificate_enroll REVOKE_CERTS), which is what produced 167k stuck
   * workflows and load 130 on 2026-07-17.
   */
  test("...and does so by REUSING the local cert, without minting a new one", () => {
    const r = runScenario({ consumerMode: "empty", localCert: pairA.cert });
    expect(r.issued).toBe(false);
    expect(r.stdout).toMatch(/reusing it, delivering to env/i);
  });

  /**
   * A mismatched pair on disk must never reach the consumer: it would break its
   * TLS, and because the delivered cert is date-valid the consumer-freshness
   * skip would then keep it broken on every later cycle.
   */
  test("local cert and key are from DIFFERENT keypairs → never delivered as-is", () => {
    const r = runScenario({ consumerMode: "empty", localCert: pairA.cert, localKey: pairB.key });

    const cert = r.delivered["NETBIRD_INTERNAL_CERT_B64"];
    const key = r.delivered["NETBIRD_INTERNAL_KEY_B64"];
    if (cert || key) {
      // If anything was delivered at all, it must be a matching pair.
      expect(pubOf(cert ?? "", "cert")).toBe(pubOf(key ?? "", "key"));
    }
    expect(r.stdout).toMatch(/do not match/i);
  });

  /**
   * cert_dir_for() maps by hostname PREFIX, so after a MESH_TLD change the
   * directory still resolves while the cert inside carries the OLD FQDN. Dates
   * alone would pass it straight into the consumer's env.
   */
  test("local cert is date-valid but for a DIFFERENT FQDN → re-issued, never reused", () => {
    const r = runScenario({
      consumerMode: "empty",
      localCert: pairStale.cert,
      localKey: pairStale.key,
    });

    expect(r.stdout).toMatch(/does not cover/i);
    // It must NOT take the reuse shortcut...
    expect(r.stdout).not.toMatch(/reusing it, delivering to env/i);
    // ...it must mint a fresh one instead...
    expect(r.issued).toBe(true);
    // ...and whatever reaches the consumer must not be the stale cert.
    expect(r.delivered["NETBIRD_INTERNAL_CERT_B64"] ?? "").not.toContain("BEGIN CERTIFICATE");
  });

  /**
   * Negative control: the no-needless-churn behaviour that gate 1 exists for
   * must survive. Without this, "always deliver" would pass the tests above and
   * restart the consumer on every cycle.
   */
  test("consumer already holds a valid cert → skips, no delivery, no restart, no issuance", () => {
    const r = runScenario({ consumerMode: "valid", localCert: pairA.cert });

    expect(r.rc).toBe("0");
    expect(r.delivered).toEqual({});
    expect(r.restarted).toBe(false);
    expect(r.issued).toBe(false);
    expect(r.stdout).toMatch(/consumer cert valid beyond/i);
  });

  /**
   * "I could not read the consumer" is not "the consumer holds nothing".
   * The real current_cert_pem collapses a 5xx, an expired token and non-base64
   * garbage into the same empty string; under this fix empty now means
   * "deliver + restart", so an unreadable consumer must not trigger a restart.
   */
  test("consumer state UNREADABLE → does not restart the consumer on a guess", () => {
    const r = runScenario({ consumerMode: "unreadable", localCert: pairA.cert });
    expect(r.restarted).toBe(false);
  });

  /**
   * ...and the same, through the REAL current_cert_pem. The test above stubs the
   * function out, so it only pins the caller. This one breaks the Coolify API
   * call inside it, which is what pins current_cert_pem itself to reporting the
   * failure rather than returning an empty string the caller cannot tell apart.
   */
  test("Coolify API read FAILS → treated as unknown, not as 'consumer has nothing'", () => {
    const r = runScenario({ consumerMode: "api-down", localCert: pairA.cert });

    expect(r.restarted).toBe(false);
    expect(r.delivered).toEqual({});
    expect(r.stdout).toMatch(/state UNKNOWN, not guessing/i);
  });

  /**
   * Nothing anywhere → the normal issuance path must still run.
   */
  test("neither consumer nor local volume has a cert → issues", () => {
    const r = runScenario({ consumerMode: "empty", localCert: null });
    expect(r.issued).toBe(true);
  });
});

/**
 * R1 + R2: the two defects an adversarial review found in the FIRST version of
 * this fix. Both are the very class the fix exists to eliminate, so they get
 * dedicated coverage rather than a comment.
 */
describe("pki-renewer: the fix must not reintroduce its own defect class", () => {
  /**
   * The seam must never be able to stop the renewer.
   *
   * MUST run under a shell where a top-level `return` SUCCEEDS — dash, zsh and
   * busybox ash all do, and busybox ash is what the container actually uses
   * (Dockerfile.pki-init is alpine-based). bash is the ONLY shell that errors
   * there, so a test run under bash proves nothing: the first version of this
   * seam relied on that error and would have silently killed the renewer in
   * production while passing its gate.
   */
  const altShell = ["dash", "zsh"].find(
    (sh) => spawnSync("command", ["-v", sh], { shell: true, encoding: "utf-8" }).status === 0,
  );

  test("seam is inert when the script is EXECUTED, under a non-bash POSIX shell", () => {
    expect(
      altShell,
      "need dash or zsh to test this faithfully; bash cannot reproduce the failure",
    ).toBeTruthy();

    const dir = mkdtempSync(join(workdir, "seam-"));
    const copy = join(dir, "pki-renewer.sh"); // basename matters: the guard keys on $0
    writeFileSync(copy, readFileSync(RENEWER, "utf-8"), { mode: 0o755 });

    const r = spawnSync(altShell!, [copy], {
      encoding: "utf-8",
      timeout: 8000,
      env: {
        ...process.env,
        PKI_RENEWER_LIB_ONLY: "1",
        PKI_CERTS_DIR: join(dir, "certs"),
        KEYCLOAK_URL: "http://kc.invalid",
        KEYCLOAK_REALM: "test",
        COOLIFY_API: "http://coolify.invalid/api/v1",
        COOLIFY_API_TOKEN: "stub",
        RENEW_SERVICES: "netbird.mesh.test.internal",
      },
    });

    const out = (r.stdout ?? "") + (r.stderr ?? "");
    // It must say so out loud...
    expect(out).toMatch(/EXECUTED, not sourced/i);
    // ...and it must actually keep running, i.e. reach the daemon banner.
    expect(out).toMatch(/PKI Renewer \(unified issuer\)/);
  });

  /**
   * A delivery whose restart failed must be RETRIED on the next cycle. It cannot
   * be, if the retry decision is taken from the env this process itself wrote —
   * that is the self-sealing skip, measured at exactly one restart attempt ever.
   */
  test("restart failed on cycle 1 → cycle 2 redelivers instead of skipping", () => {
    const scen = mkdtempSync(join(workdir, "cycles-"));
    const certsDir = join(scen, "certs");
    mkdirSync(join(certsDir, "netbird-mesh"), { recursive: true });
    writeFileSync(join(certsDir, "netbird-mesh/cert.pem"), pairA.cert);
    writeFileSync(join(certsDir, "netbird-mesh/key.pem"), pairA.key);
    // The consumer starts empty; patch_env persists, exactly like Coolify would.
    writeFileSync(join(scen, "consumer.pem"), "");

    const harness = join(scen, "h.sh");
    writeFileSync(
      harness,
      `#!/bin/sh
SCEN="${scen}"
export KEYCLOAK_URL=http://kc.invalid KEYCLOAK_REALM=test
export COOLIFY_API=http://coolify.invalid/api/v1 COOLIFY_API_TOKEN=t
export RENEW_SERVICES=netbird.mesh.test.internal PKI_ISSUER_CLIENT_SECRET=s
export PKI_CERTS_DIR="$SCEN/certs" APP_NAME_PREFIX=aisha
PKI_RENEWER_LIB_ONLY=1 . "${RENEWER}"

app_uuid_by_name() { echo uuid-netbird; }
current_cert_pem() { cat "$SCEN/consumer.pem"; }
get_token()        { echo t; }
# Persist like Coolify does, so cycle 2 reads back what cycle 1 wrote.
patch_env()        { [ "$2" = NETBIRD_INTERNAL_CERT_B64 ] && printf '%s' "$3" | base64 -d > "$SCEN/consumer.pem"; echo 200; }
persist_issued_cert() { return 0; }
curl() { printf ''; }
# The restart NEVER succeeds — that is the condition under test.
restart_app()      { echo attempt >> "$SCEN/attempts.log"; echo 500; }

set +e
for i in 1 2 3; do
  echo "--- CYCLE $i ---"
  process_service netbird.mesh.test.internal
done
set -e
`,
      { mode: 0o755 },
    );

    const r = spawnSync("sh", [harness], { encoding: "utf-8", timeout: 30_000 });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    const attemptsFile = join(scen, "attempts.log");
    const attempts = existsSync(attemptsFile)
      ? readFileSync(attemptsFile, "utf-8").trim().split("\n").filter(Boolean).length
      : 0;

    // Every cycle must try again while the consumer has not loaded the cert.
    expect(attempts).toBeGreaterThanOrEqual(3);
    // And it must NOT have declared the consumer fresh off its own write.
    expect(out).not.toMatch(/consumer cert valid beyond/i);
    expect(out).toMatch(/never loaded/i);
  });
});
