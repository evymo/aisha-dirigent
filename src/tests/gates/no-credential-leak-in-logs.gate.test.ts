/**
 * No-Credential-Leak-In-Logs Gate
 *
 * Deploy scripts legitimately build git URLs with embedded credentials —
 * Coolify cannot read the host's ~/.git-credentials, so the token must travel
 * inside the `git_repository` value it stores. That credentialed string belongs
 * in the API PAYLOAD and nowhere else.
 *
 * It used to leak: coolify-story-init.sh's dry-run branch printed
 *   warn "  git: ${GIT_URL}@${GIT_BRANCH}"
 * which put the raw Forgejo token on the terminal — and into the CI job log
 * whenever the script runs in a pipeline (found 2026-07-20 while provisioning
 * svc-source-broker). A token in a build log is a token you must rotate.
 *
 * The repo's established fix is a token-free twin next to the credentialed
 * value (scripts/instance-rollout.sh, scripts/deploy/instance-data-hook.sh both
 * derive a REDACTED form with `sed -E 's|(://)[^@/]+@|\1***@|'`). This gate
 * keeps that invariant from regressing:
 *
 *   1. the twin EXISTS where credentials are embedded;
 *   2. no shell script prints a credential-bearing URL variable;
 *   3. no shell script interpolates the token into anything human-facing.
 *
 * Run: npm run test:gates
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

/** Every .sh under scripts/, recursively. */
function shellScripts(dir = "scripts"): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((entry) => {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) return shellScripts(join(dir, entry));
    return entry.endsWith(".sh") ? [relative(ROOT, full)] : [];
  });
}

/** Commands that put text in front of a human or a CI log. */
const PRINTERS = String.raw`(?:info|warn|err|ok|step|log|die|echo|printf)`;

describe("no credential leak in logs", () => {
  test("story-init derives a token-free twin of the credentialed git URL", () => {
    const s = read("scripts/coolify-story-init.sh");
    expect(s, "scripts/coolify-story-init.sh not found").not.toBe("");
    // It embeds credentials…
    expect(s).toMatch(/GIT_URL="https:\/\/aisha:\$\{FORGEJO_TOKEN\}@/);
    // …so it must also derive the redacted form used for output.
    expect(s, "GIT_URL_SAFE (redacted twin) must be derived where GIT_URL gains credentials")
      .toMatch(/GIT_URL_SAFE=.*sed -E 's\|\(:\/\/\)\[\^@\/\]\+@\|/);
  });

  test("no shell script prints a credential-bearing *_GIT_URL variable", () => {
    // A `${...GIT_URL}` interpolation inside a printing command. Names ending in
    // _SAFE / _REDACTED are the sanctioned token-free twins. Prose that merely
    // NAMES a variable (no ${}) is fine — it carries no value.
    const re = new RegExp(
      String.raw`^\s*${PRINTERS}\b[^\n]*\$\{?([A-Z_]*GIT_URL)(?![A-Z_])`,
      "gm",
    );
    const offenders: string[] = [];
    for (const file of shellScripts()) {
      const body = readFileSync(join(ROOT, file), "utf8");
      body.split("\n").forEach((line, i) => {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (m && !/_SAFE$|_REDACTED$/.test(m[1])) offenders.push(`${file}:${i + 1} → ${m[1]}`);
      });
    }
    expect(offenders, `print a redacted twin instead:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  test("no shell script interpolates FORGEJO_TOKEN into printed output", () => {
    const offenders: string[] = [];
    for (const file of shellScripts()) {
      const body = readFileSync(join(ROOT, file), "utf8");
      body.split("\n").forEach((line, i) => {
        const printing = new RegExp(String.raw`^\s*${PRINTERS}\b`).test(line);
        // `\$FORGEJO_API_TOKEN` is ESCAPED — the shell prints the literal name,
        // which is how coolify-server-onboard.sh hands the operator a command to
        // paste. Only an UNescaped `$` substitutes the value, so the lookbehind
        // is what makes this check mean "emits the token" rather than "mentions
        // it". Getting that wrong is the difference between a real finding and
        // an exception list.
        const interpolates = /(?<!\\)\$\{?FORGEJO_(API_)?TOKEN/.test(line);
        if (printing && interpolates) {
          // `[ -n "$FORGEJO_TOKEN" ] && echo yes || echo no` reports PRESENCE;
          // the value itself never reaches the output stream.
          const presenceTestOnly = /-n\s+"?\$\{?FORGEJO_(API_)?TOKEN/.test(line);
          if (!presenceTestOnly) offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offenders, `token must never reach stdout:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
