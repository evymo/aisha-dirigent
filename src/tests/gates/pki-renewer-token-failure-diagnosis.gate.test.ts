/**
 * pki-renewer: a failed token acquisition must say WHICH failure it was
 *
 * WHY (mesh outage 2026-07-29 → wrong diagnosis 2026-07-30):
 *   get_token() ran `curl -fsS … 2>/dev/null`. Those two flags together erased the
 *   only evidence of why a renewal cycle died:
 *     -f          discards the 4xx BODY — and that body is where Keycloak says
 *                 `invalid_client` (client absent from the realm, or a secret that
 *                 disagrees with the one KC holds).
 *     2>/dev/null discards curl's own transport errors (DNS failure, TLS reject,
 *                 timeout).
 *   Every distinct cause collapsed into one line:
 *     "client_credentials token acquisition failed (client=…, kc=…)"
 *
 *   That is not a cosmetic logging gap. "Unreachable" and "refused" demand OPPOSITE
 *   fixes — a topology change vs a secret re-sync — and with the evidence gone, the
 *   live outage was read as a hairpin. The proposed fix (point KEYCLOAK_URL at the
 *   internal alias) would have re-opened incident 2026-07-17, which
 *   pki-renewer-kc-public-dns.gate.test.ts exists to prevent.
 *
 *   So this gate pins the DISTINCTION, not the wording: a refusal must report the
 *   HTTP status and Keycloak's own error code; an unreachable endpoint must be named
 *   as unreachable and never dressed up as an HTTP answer. It also pins that the
 *   diagnosis can never leak the client secret, and that `-f` / `2>/dev/null` do not
 *   come back as a "cleanup".
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = process.cwd();
const RENEWER = join(ROOT, "infra/pki/pki-renewer.sh");
const SECRET = "s3cr3t-must-never-be-logged";

/**
 * ⛔ TAHLE BRÁNA SPOUŠTÍ SKUTEČNÝ `get_token()`, a ten používá `jq`.
 *
 * NAMĚŘENO 2026-08-11: v CI (Web: Tests → krok Gate tests) padly čtyři
 * behaviorální testy, zatímco lokálně procházely 6/6. Rozdíl NEBYL v kódu —
 * na runneru prostě není `jq`. Reprodukováno schováním jq z PATH: padnou přesně
 * ty čtyři, statické dva projdou.
 *
 * Renewer běží v kontejneru, který `jq` MÁ, takže závislost je legitimní; chybná
 * byla jen její NEDEKLAROVANOST. Bez tohohle tvrzení hlásí brána čtyři záhadné
 * neshody v očekávaném výstupu místo jedné věty o chybějícím nástroji —
 * ukazuje na kód, a příčina je v prostředí.
 *
 * ZÁMĚRNĚ `throw`, ne `skip`: přeskočená brána nehlídá nic (rodina
 * „gates green because invisible"). CI ho doplňuje ve svém setupu.
 */
function vyzadujJq(): void {
  const r = spawnSync("sh", ["-c", "command -v jq"], { encoding: "utf-8" });
  if (r.status !== 0 || !(r.stdout || "").trim()) {
    throw new Error(
      "pki-renewer gate: `jq` NENÍ na PATH. Brána spouští skutečný get_token(), " +
        "který jq používá k rozebrání odpovědi Keycloaku — bez něj by čtyři " +
        "behaviorální testy padly na 'prázdný výstup' a ukazovaly na kód místo " +
        "na prostředí. Doplň jq (CI: krok 'Install jq'; lokálně: brew/apk install jq).",
    );
  }
}

let workdir: string;

/** Wrap a value as a shell single-quoted literal (no escape sequences interpreted). */
function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Drive the REAL get_token() against a stubbed curl.
 *
 * `curlBody` is what the stub writes to stdout — including the trailing status line,
 * exactly as real curl does under `-w '\n%{http_code}'`. `curlStderr` is what it writes
 * to stderr, which is how curl reports a transport failure.
 *
 * The body goes through a QUOTED heredoc, not printf. An earlier revision passed it as
 * a printf argument via JSON.stringify, which re-escaped the newline: the stub then
 * emitted one line containing a literal `\n`, every scenario fell into the
 * no-status branch, and the transport-failure test passed for the wrong reason. A
 * stub that cannot reproduce a multi-line response cannot test a parser that splits
 * body from status.
 *
 * stdout and stderr are captured SEPARATELY on purpose: the caller in the real script
 * does `token="$(get_token)"`, so anything the diagnosis writes to stdout would be
 * swallowed into the token itself. Merging them here would hide exactly that bug.
 */
function runGetToken(opts: { curlBody: string; curlStderr?: string }): {
  stdout: string;
  stderr: string;
} {
  const scen = mkdtempSync(join(workdir, "tok-"));
  const harness = join(scen, "harness.sh");

  writeFileSync(
    harness,
    `#!/bin/sh
export KEYCLOAK_URL=https://auth.example.invalid
export KEYCLOAK_REALM=test
export COOLIFY_API=http://coolify.invalid/api/v1
export COOLIFY_API_TOKEN=stub-token
export RENEW_SERVICES=netbird.mesh.test.internal
export PKI_ISSUER_CLIENT_SECRET=${sq(SECRET)}

PKI_RENEWER_LIB_ONLY=1 . "${RENEWER}"

# Stub curl AFTER sourcing so it overrides the real binary lookup.
curl() {
${opts.curlStderr ? `  printf '%s\\n' ${sq(opts.curlStderr)} >&2` : "  :"}
  cat <<'AISHA_STUB_CURL_BODY'
${opts.curlBody}
AISHA_STUB_CURL_BODY
}

set +e
get_token
set -e
`,
    { mode: 0o755 },
  );

  const r = spawnSync("sh", [harness], { encoding: "utf-8", timeout: 30_000 });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

beforeAll(() => {
  vyzadujJq();
  workdir = mkdtempSync(join(tmpdir(), "pki-renewer-token-gate-"));
});

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("pki-renewer: token failure names its own cause", () => {
  test("HTTP 200 → the token reaches stdout and nothing is reported as a failure", () => {
    const { stdout, stderr } = runGetToken({
      curlBody: '{"access_token":"tok-abc123"}\n200',
    });
    expect(stdout.trim()).toBe("tok-abc123");
    expect(stderr).not.toMatch(/UNREACHABLE|REFUSED/);
  });

  test("Keycloak REFUSES (401 invalid_client) → status + KC's error code are reported", () => {
    const { stdout, stderr } = runGetToken({
      curlBody:
        '{"error":"invalid_client","error_description":"Invalid client credentials"}\n401',
    });
    // No token — the caller must not receive a diagnosis in place of one.
    expect(stdout.trim()).toBe("");
    expect(stderr).toMatch(/REFUSED HTTP 401/);
    expect(
      stderr,
      "the refusal must carry Keycloak's own error code — that is what separates " +
        "'this client does not exist / the secret disagrees' from every other cause",
    ).toMatch(/invalid_client/);
    expect(stderr).not.toMatch(/UNREACHABLE/);
  });

  test("transport failure (no HTTP response, 000) → reported as UNREACHABLE, not as a status", () => {
    const { stdout, stderr } = runGetToken({
      curlBody: "\n000",
      curlStderr: "curl: (6) Could not resolve host: auth.example.invalid",
    });
    expect(stdout.trim()).toBe("");
    expect(
      stderr,
      "000 is the ABSENCE of a response, not an HTTP status — reporting it as a " +
        "refusal points the reader at the secret when the real fix is topology",
    ).toMatch(/UNREACHABLE/);
    expect(stderr).not.toMatch(/REFUSED/);
    // curl's own words must survive — they name the actual transport fault.
    expect(stderr).toMatch(/Could not resolve host/);
  });

  test("a refusal never echoes upstream free text (and so never the secret) into the log", () => {
    const { stdout, stderr } = runGetToken({
      // The endpoint's `error_description` is free text we do not control. This gate
      // caught the first version of the fix logging it verbatim — harmless against a
      // real Keycloak, but it makes the log a passthrough for whatever the endpoint
      // returns. Only the machine-readable `.error` is echoed now.
      curlBody: `{"error":"invalid_client","error_description":"${SECRET}"}\n401`,
    });
    expect(stdout + stderr).not.toContain(SECRET);
    // ...while staying diagnosable: the error CODE is what distinguishes the causes,
    // and the fingerprint correlates the secret across renewer and Keycloak without
    // either side disclosing it.
    expect(stderr).toMatch(/invalid_client/);
    expect(stderr).toMatch(/secret_fp=[0-9a-f]{12}/);
  });
});

describe("pki-renewer: the erasing flags must not come back", () => {
  const getTokenBody = (() => {
    const src = readFileSync(RENEWER, "utf-8");
    const start = src.indexOf("\nget_token() {");
    expect(start, "could not locate get_token() in pki-renewer.sh").toBeGreaterThan(-1);
    const end = src.indexOf("\n}", start);
    return src.slice(start, end);
  })();

  test("get_token does not use `curl -f` (it discards the 4xx body that names the cause)", () => {
    expect(
      getTokenBody,
      "`-f` makes curl throw away the response body on 4xx — the body is the only " +
        "place Keycloak says invalid_client. Capture the status instead.",
    ).not.toMatch(/curl\s+(-\w*f\w*|--fail\b)/);
  });

  test("get_token does not discard curl's stderr (it carries the transport fault)", () => {
    // Scoped to the request itself: jq's own `2>/dev/null` a few lines below is
    // legitimate (it suppresses a parse error on a non-JSON body, and the HTTP status
    // is still reported). What must never come back is discarding CURL's stderr.
    const requestLines = getTokenBody
      .split("\n")
      .filter((l) => !/\bjq\b/.test(l))
      .join("\n");

    expect(
      requestLines,
      "2>/dev/null throws away DNS/TLS/timeout errors, which is what distinguishes " +
        "'unreachable' from 'refused'. Fold it into the capture with 2>&1 instead.",
    ).not.toMatch(/2>\s*\/dev\/null/);

    expect(
      requestLines,
      "curl's stderr must be folded INTO the captured response, or a transport " +
        "failure arrives as an empty body with no explanation.",
    ).toMatch(/2>&1/);
  });
});
