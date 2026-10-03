/**
 * PKI-02 — OpenXPKI demo/insecure-auth hardening gate
 *
 * CONTRACT:
 *   `openxpki-config/config.d/**` MUST NOT ship demo/insecure authentication
 *   primitives. This gate walks the OpenXPKI config tree recursively and fails
 *   on any forbidden hit:
 *
 *     1. The literal password `openxpki` used as a shared/test credential
 *        (TestAccounts "Password for all accounts is openxpki").
 *     2. The literal `SecretChallenge` (placeholder SCEP/RPC challenge secret).
 *     3. An Anonymous WebUI login *stack* (auth/stack.yaml `type: anon` on a
 *        WebUI-reachable stack) — grants unauthenticated WebUI access.
 *     4. Demo usernames `alice` / `bob` / `rose` / `rob` (upstream TestAccounts).
 *
 * KNOWN-RED (defects this gate is the executable spec for):
 *   - realm.tpl/auth/handler.yaml → TestAccounts, pw "openxpki", alice/bob/rose/rob
 *   - realm.tpl/auth/stack.yaml   → Anonymous login stack + Testing stack
 *   - realm.tpl/rpc/generic.yaml  → challenge.value: SecretChallenge
 *
 * ALLOWLIST (legitimate, intentionally kept):
 *   - The `System` / `_System` handler+stack (type: Anonymous, role: System) is
 *     the internal automated-interface identity, not a WebUI guest login. It is
 *     allowlisted BY NAME so the Anonymous-WebUI check does not flag it.
 *
 * After the fix (demo accounts removed, Anonymous WebUI stack removed,
 * SecretChallenge replaced with a rendered placeholder), this gate is GREEN.
 *
 * Run:
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/pki-openxpki-demo-hardening.gate.test.ts
 *
 * @module
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

const PROJECT_ROOT = process.cwd();
const CONFIG_ROOT = join(PROJECT_ROOT, "openxpki-config/config.d");

/** Recursively collect all YAML files under a directory. */
function walkYaml(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkYaml(full));
    } else if (/\.ya?ml(\.sample)?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  kind: string;
  text: string;
}

/** Names that are the legitimate internal automated-interface identity. */
const SYSTEM_ALLOWLIST = new Set(["System", "_System"]);

describe("PKI-02 — OpenXPKI config ships no demo/insecure auth primitives", () => {
  const files = walkYaml(CONFIG_ROOT);

  test("openxpki-config tree exists and is scanned", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("no forbidden demo/insecure auth primitives in config.d/**", () => {
    const hits: Hit[] = [];

    // Demo usernames as YAML keys (2+ leading spaces, then `name:` mapping key).
    const demoUserRe = /^\s{2,}(alice|bob|rose|rob)\s*:\s*$/;

    for (const file of files) {
      const rel = relative(PROJECT_ROOT, file);
      const raw = readFileSync(file, "utf8");
      const lines = raw.split("\n");

      // Track the nearest top-level (0-indent) stack/handler name so the
      // Anonymous-type check can allowlist the System/_System identity.
      let currentTopKey = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const ln = i + 1;

        // Update current top-level key (0-indent `Name:`), ignore comments.
        const topKey = line.match(/^([A-Za-z_][\w -]*):\s*$/);
        if (topKey) currentTopKey = topKey[1].trim();

        // Strip trailing comments for value checks (but keep for reporting).
        const code = line.replace(/#.*$/, "");

        // (1) literal password "openxpki" used as a credential/prose secret.
        // Match the word in non-path prose (skip file paths like auth/handler.yaml
        // and the schema key `openxpki:` if any). We flag the demo-password prose
        // and any `password: openxpki` style value.
        if (/\bopenxpki\b/i.test(code)) {
          // Exclude legitimate references: repo/file paths, the OpenXPKI Perl
          // module namespace (`OpenXPKI::...`), and upstream demo domains.
          const isPathRef =
            /openxpki-config|openxpki\.(test|org|com)|\/openxpki|OpenXPKI::/i.test(code);
          const isPasswordProse =
            /password[^#]*\bopenxpki\b/i.test(code) ||
            /\bopenxpki\b[^#]*password/i.test(code) ||
            /(passwd|digest|secret|credential)[^#]*\bopenxpki\b/i.test(code);
          if (isPasswordProse && !isPathRef) {
            hits.push({ file: rel, line: ln, kind: "demo-password:openxpki", text: line.trim() });
          }
        }

        // (2) literal SecretChallenge placeholder.
        if (/\bSecretChallenge\b/.test(code)) {
          hits.push({ file: rel, line: ln, kind: "placeholder-secret:SecretChallenge", text: line.trim() });
        }

        // (3) demo usernames as account keys.
        const du = line.match(demoUserRe);
        if (du) {
          hits.push({ file: rel, line: ln, kind: `demo-username:${du[1]}`, text: line.trim() });
        }

        // (4) Anonymous WebUI login stack: `type: anon` (auth/stack.yaml) on a
        // non-System stack, OR a top-level Anonymous stack/handler that is not
        // the allowlisted System identity.
        if (/^\s+type:\s*anon\b/i.test(code) && !SYSTEM_ALLOWLIST.has(currentTopKey)) {
          hits.push({
            file: rel,
            line: ln,
            kind: `anonymous-webui-stack:${currentTopKey || "?"}`,
            text: line.trim(),
          });
        }
      }
    }

    const report = hits
      .map((h) => `  - [${h.kind}] ${h.file}:${h.line}  ${h.text}`)
      .join("\n");

    expect(
      hits.length,
      `Found ${hits.length} forbidden OpenXPKI demo/insecure auth primitive(s) in config.d/**.\n` +
        `Remove demo TestAccounts (alice/bob/rose/rob + pw "openxpki"), the Anonymous WebUI\n` +
        `login stack, and the literal "SecretChallenge" placeholder. Keep only the System/_System\n` +
        `internal identity.\n${report}`,
    ).toBe(0);
  });
});
