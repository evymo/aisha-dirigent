/**
 * curl %{http_code} capture integrity (CLASS gate)
 *
 * OWNS: the shape of every shell probe that reads an HTTP status code.
 *
 * ── THE MEASUREMENT ───────────────────────────────────────────────────────
 * `-w '%{http_code}'` writes the code to stdout ALWAYS — including when curl
 * exits non-zero. So a `|| fallback` does not SUBSTITUTE the sentinel, it
 * APPENDS it. Measured 2026-08-09 (curl on darwin, same on the Alpine images):
 *
 *   probe                                  connection refused   HTTP 404   HTTP 200
 *   curl -s  ... -w '%{http_code}' || echo 000     000000          404        200
 *   curl -sf ... -w '%{http_code}' || echo 000     000000        404000       200
 *   curl -s  ... -w '%{http_code}' || true           000          404        200
 *
 * Two independent defects fall out of that table:
 *
 *   A) `-f` (--fail) + `%{http_code}`: contradictory by construction. `-f` exists
 *      to turn a >= 400 into a non-zero EXIT; `%{http_code}` exists to hand you
 *      the code so you can BRANCH on it. Combining them means every >= 400 code
 *      comes back glued to the fallback text, so every branch on a >= 400 literal
 *      is unreachable.
 *
 *   B) `|| echo <sentinel>` + `%{http_code}`: curl already emits `000` on a
 *      transport failure (DNS, refused, timeout). The sentinel is therefore pure
 *      appendage — `000` becomes `000000` and the `000)` branch dies too.
 *
 * ── WHAT IT COST ──────────────────────────────────────────────────────────
 * Found 2026-08-09 while merging #846. Three confirmed live consequences:
 *
 *   · scripts/cold-start-doctor.sh — `000) fail "Coolify API unreachable"` and
 *     the Forgejo equivalent were UNREACHABLE. An unreachable Coolify produced
 *     `warn "returned HTTP 000000 (unexpected)"` instead of a hard fail. The
 *     doctor is the instrument the whole deploy is verified with; it could not
 *     fail on the one condition that matters most.
 *   · keycloak/configure-realms.sh — `409) already exists — ok` was dead, so a
 *     benign race in consumer-realm provisioning became `exit 1` mid cold-start.
 *   · scripts/provision-intranet.sh, scripts/provision-sso.sh — the checks assert
 *     health by matching 401/403, which `-f` makes unmatchable. The HEALTHY state
 *     was the one state those probes could never report.
 *
 * This is the same family as the 2026-07-19 `HTTP 000` misread: a failure of the
 * measuring tool that is shaped exactly like a measurement.
 *
 * ── THE CORRECT PRIMITIVE ─────────────────────────────────────────────────
 *   code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)
 * transport failure -> 000 · HTTP error -> the real code · curl missing -> empty.
 * All three distinguishable. `|| true` (not `|| echo`) keeps `set -e` happy
 * without contributing output.
 *
 * Deliberately NOT a shared helper: keycloak/configure-realms.sh runs inside a
 * container that has no scripts/lib/, so a helper would either be unusable there
 * or force a new coupling into the image. The primitive is one line — inline it.
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();

type Kind = "fail-flag" | "echo-sentinel";

interface Violation {
  file: string;
  line: number;
  kind: Kind;
  text: string;
}

function shellScripts(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "*.sh"], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/**
 * A curl probe is frequently split over several lines by trailing backslashes,
 * and the `$( … )` that captures it can close later still. Rejoin both so the
 * flags, the writeout and the `||` fallback are judged as ONE command — a
 * per-line matcher would miss most real sites.
 *
 * Rewinds first: `%{http_code}` often sits on a CONTINUATION line while `-sf`
 * is back on the line that opened the command. Scanning only forward from the
 * writeout would leave the gate blind to exactly the shape it exists to catch.
 */
function joinCommand(lines: string[], anchor: number): string {
  let start = anchor;
  while (start > 0 && lines[start - 1].trimEnd().endsWith("\\")) start--;

  let cmd = lines[start];
  let i = start;
  while (cmd.trimEnd().endsWith("\\") && i + 1 < lines.length) {
    i++;
    cmd = cmd.trimEnd().slice(0, -1) + " " + lines[i];
  }
  // keep absorbing while the capturing $( is still open
  let guard = 0;
  while ((cmd.split("$(").length - 1) > (cmd.split(")").length - 1) && i + 1 < lines.length && guard < 20) {
    i++;
    guard++;
    cmd += " " + lines[i];
  }
  return cmd;
}

/** `-sf`, `-fsSL`, `--fail`, `--fail-with-body` — but never `-F`, `--form`, `-o`. */
function hasFailFlag(cmd: string): boolean {
  if (/--fail\b/.test(cmd)) return true;
  return cmd
    .split(/\s+/)
    .some((tok) => /^-[a-zA-Z]+$/.test(tok) && tok.includes("f"));
}

/**
 * Narrow a joined command to the ONE curl invocation that owns the writeout.
 *
 * A joined line can hold several commands chained with `||`/`&&`/`|` — e.g.
 * `curl -sf URL -o /dev/null || curl -s URL -w '%{http_code}' | grep …`, where
 * the FIRST curl legitimately uses -f as a boolean success test and the second
 * is the one being judged. Attributing the first one's -f to the second is the
 * same conflation that makes `|| \` look like a line continuation of one
 * command instead of a separator between two.
 *
 * The fail-flag verdict therefore reads only from the last `curl` before the
 * writeout up to the next separator AFTER it. The sentinel verdict deliberately
 * keeps the tail — `|| echo 000` lives past a separator by construction.
 */
function ownerSegment(cmd: string, writeoutAt: number): string {
  const start = cmd.lastIndexOf("curl", writeoutAt);
  const from = start === -1 ? 0 : start;
  const sep = cmd.slice(writeoutAt).search(/\|\||&&|;|\|(?!\|)/);
  const to = sep === -1 ? cmd.length : writeoutAt + sep;
  return cmd.slice(from, to);
}

export function findHttpCodeCaptureViolations(file: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("%{http_code}")) continue;
    const cmd = joinCommand(lines, i);
    const writeoutAt = cmd.indexOf("%{http_code}");
    const text = lines[i].trim();

    if (hasFailFlag(ownerSegment(cmd, writeoutAt))) {
      violations.push({ file, line: i + 1, kind: "fail-flag", text });
    }
    if (/\|\|\s*(echo|printf)\b/.test(cmd.slice(writeoutAt))) {
      violations.push({ file, line: i + 1, kind: "echo-sentinel", text });
    }
  }

  return violations;
}

const EXPLAIN: Record<Kind, string> = {
  "fail-flag":
    "curl -f/--fail together with -w '%{http_code}': -f turns >= 400 into a non-zero " +
    "exit while the writeout still prints the code, so the captured value is the code " +
    "GLUED to whatever the fallback printed. Every branch on a >= 400 literal is dead. " +
    "Drop -f — you already have the code to branch on.",
  "echo-sentinel":
    "|| echo <sentinel> after -w '%{http_code}': curl already prints 000 on a transport " +
    "failure, so the sentinel is appended (000 -> 000000) and the 000) branch is dead. " +
    "Use `|| true`.",
};

describe("curl %{http_code} capture integrity", () => {
  test("no shell probe glues a fallback onto the status code", () => {
    const violations: Violation[] = [];
    for (const file of shellScripts()) {
      const content = readFileSync(join(ROOT, file), "utf-8");
      violations.push(...findHttpCodeCaptureViolations(file, content));
    }

    if (violations.length > 0) {
      const byKind = (k: Kind) => violations.filter((v) => v.kind === k);
      const render = (k: Kind) => {
        const rows = byKind(k);
        if (!rows.length) return "";
        return (
          `\n── ${k} (${rows.length}) ──\n${EXPLAIN[k]}\n\n` +
          rows.map((v) => `  ${v.file}:${v.line}\n    ${v.text}`).join("\n")
        );
      };
      throw new Error(
        `Found ${violations.length} HTTP-status probe(s) whose captured value is not the status code.\n` +
          `Correct primitive:\n` +
          `  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)\n` +
          render("fail-flag") +
          render("echo-sentinel"),
      );
    }
    expect(violations).toEqual([]);
  });

  // Negative tests — a gate that cannot fail is not a gate.
  test("catches the doctor shape: || echo 000 appends to the code", () => {
    const sample = [
      `    rc=$(curl -sS -o /dev/null -w "%{http_code}" -m "$T" "$URL" 2>/dev/null || echo "000")`,
    ].join("\n");
    const found = findHttpCodeCaptureViolations("s.sh", sample);
    expect(found.map((v) => v.kind)).toEqual(["echo-sentinel"]);
  });

  test("catches the configure-realms shape: -f plus a code branch", () => {
    const sample = [
      `HTTP=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$URL" --data-binary @"$F" 2>/dev/null || echo "ERR")`,
    ].join("\n");
    const found = findHttpCodeCaptureViolations("s.sh", sample).map((v) => v.kind).sort();
    expect(found).toEqual(["echo-sentinel", "fail-flag"]);
  });

  test("catches -f even when the flags are split across continuation lines", () => {
    const sample = [
      `  code=$(curl -sfS \\`,
      `    -o /dev/null -w "%{http_code}" \\`,
      `    "$URL")`,
    ].join("\n");
    expect(findHttpCodeCaptureViolations("s.sh", sample).map((v) => v.kind)).toEqual(["fail-flag"]);
  });

  test("the corrected primitive is accepted", () => {
    const sample = `code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null || true)`;
    expect(findHttpCodeCaptureViolations("s.sh", sample)).toEqual([]);
  });

  test("|| : is accepted as well (same no-output guard)", () => {
    const sample = `code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || :)`;
    expect(findHttpCodeCaptureViolations("s.sh", sample)).toEqual([]);
  });

  test("curl -f without a writeout is none of this gate's business", () => {
    const sample = `curl -sfSL -o out.tar.gz "$URL"`;
    expect(findHttpCodeCaptureViolations("s.sh", sample)).toEqual([]);
  });

  test("-F/--form is not mistaken for --fail", () => {
    const sample = `code=$(curl -s -F file=@x.json -o /dev/null -w '%{http_code}' "$URL" || true)`;
    expect(findHttpCodeCaptureViolations("s.sh", sample)).toEqual([]);
  });

  test("a -f on a SIBLING curl in the same || chain is not attributed to the probe", () => {
    // scripts/ai/mode-switch.sh shape: the first curl uses -f as a boolean
    // success test (no writeout, entirely correct); the second is the probe.
    // `|| \` makes them look like one continued command — they are two.
    const sample = [
      `  if curl -sf "$URL" -o /dev/null 2>&1 || \\`,
      `     curl -s "$URL" -w "%{http_code}" -o /dev/null 2>&1 | grep -qE "^[24]"; then`,
    ].join("\n");
    expect(findHttpCodeCaptureViolations("s.sh", sample)).toEqual([]);
  });

  test("…but a -f on the probe itself is still caught in that same shape", () => {
    const sample = [
      `  if curl -sf "$URL" -o /dev/null 2>&1 || \\`,
      `     curl -sf "$URL" -w "%{http_code}" -o /dev/null 2>&1 | grep -qE "^[24]"; then`,
    ].join("\n");
    expect(findHttpCodeCaptureViolations("s.sh", sample).map((v) => v.kind)).toEqual(["fail-flag"]);
  });

  test("an || echo that belongs to a LATER command is not attributed here", () => {
    // The probe is closed on its own line; the echo below is a separate statement.
    const sample = [
      `code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)`,
      `[ "$code" = "200" ] || echo "unhealthy"`,
    ].join("\n");
    expect(findHttpCodeCaptureViolations("s.sh", sample)).toEqual([]);
  });
});
