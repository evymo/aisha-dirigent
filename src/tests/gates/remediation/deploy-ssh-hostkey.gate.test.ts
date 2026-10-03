/**
 * Remediation Gate: Deploy SSH host-key verification MUST NOT be disabled.
 *
 * CONTRACT:
 *   No deploy code may disable SSH host-key verification. Specifically:
 *     - `StrictHostKeyChecking=no` (accepts ANY host key → MITM) is forbidden.
 *     - `ANSIBLE_HOST_KEY_CHECKING` set to 'False'/'false' is forbidden.
 *   Deploy code MUST instead use a managed known_hosts file, or at minimum
 *   `StrictHostKeyChecking=accept-new` (TOFU: pin on first connect, verify
 *   thereafter) / `ANSIBLE_HOST_KEY_CHECKING=True`.
 *
 * This is a PATTERN gate: it scans every deploy connector plus the gateway
 * deployment executor, so a fix in one file that leaves a sibling regressed
 * (or a new connector re-introducing the pattern) is caught.
 *
 * KNOWN-RED at authoring (HEAD 569c5ffd):
 *   - deploy/connectors/ssh.mjs                          → StrictHostKeyChecking=no
 *   - services/gateway/src/routes/deployment-executor.ts → StrictHostKeyChecking=no (x2)
 *                                                          + ANSIBLE_HOST_KEY_CHECKING:'False'
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

/**
 * Files in scope: every *.mjs deploy connector plus the gateway deployment
 * executor. Directory-walked so new connectors are auto-covered.
 */
function collectScopedFiles(): string[] {
  const files: string[] = [];

  const connectorsDir = path.join(ROOT, "deploy/connectors");
  if (fs.existsSync(connectorsDir)) {
    for (const entry of fs.readdirSync(connectorsDir)) {
      if (entry.endsWith(".mjs")) {
        files.push(path.join(connectorsDir, entry));
      }
    }
  }

  const executor = path.join(
    ROOT,
    "services/gateway/src/routes/deployment-executor.ts",
  );
  if (fs.existsSync(executor)) files.push(executor);

  return files;
}

/**
 * Intentional exceptions (documented). Empty — the contract admits no
 * legitimate reason to disable host-key checking in deploy code.
 */
const ALLOWLIST: ReadonlyArray<string> = [];

// StrictHostKeyChecking=no  (allow arbitrary spacing around '=')
const STRICT_HOST_KEY_NO = /StrictHostKeyChecking\s*=\s*no\b/i;
// ANSIBLE_HOST_KEY_CHECKING set to False (env-object value or shell assignment)
const ANSIBLE_HOST_KEY_FALSE =
  /ANSIBLE_HOST_KEY_CHECKING["'\s]*[:=]\s*["']?\s*false\b/i;

interface Violation {
  file: string;
  line: number;
  text: string;
  rule: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];
  for (const file of collectScopedFiles()) {
    const rel = path.relative(ROOT, file);
    if (ALLOWLIST.includes(rel)) continue;
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    lines.forEach((text, i) => {
      if (STRICT_HOST_KEY_NO.test(text)) {
        violations.push({
          file: rel,
          line: i + 1,
          text: text.trim(),
          rule: "StrictHostKeyChecking=no",
        });
      }
      if (ANSIBLE_HOST_KEY_FALSE.test(text)) {
        violations.push({
          file: rel,
          line: i + 1,
          text: text.trim(),
          rule: "ANSIBLE_HOST_KEY_CHECKING=False",
        });
      }
    });
  }
  return violations;
}

describe("Remediation: deploy SSH host-key verification", () => {
  it("in-scope files exist (guard against silent no-op scan)", () => {
    const files = collectScopedFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.some((f) => f.endsWith("deploy/connectors/ssh.mjs")),
    ).toBe(true);
    expect(
      files.some((f) =>
        f.endsWith("services/gateway/src/routes/deployment-executor.ts"),
      ),
    ).toBe(true);
  });

  it("no deploy code disables SSH host-key verification", () => {
    const violations = scan();
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`)
      .join("\n");
    expect(
      violations,
      violations.length === 0
        ? ""
        : `Forbidden SSH host-key bypass(es) found — use a managed known_hosts ` +
            `or StrictHostKeyChecking=accept-new / ANSIBLE_HOST_KEY_CHECKING=True:\n${report}`,
    ).toEqual([]);
  });
});
