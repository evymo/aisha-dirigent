/**
 * Shell Heredoc Metacharacter Gate
 *
 * OWNS: prose safety inside UNQUOTED heredoc bodies in shell scripts.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * A backtick inside an unquoted heredoc (`<<TAG`, not `<<'TAG'`) must be
 * backslash-escaped. An unescaped one is COMMAND SUBSTITUTION, not markdown.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 * `<<TAG` expands `$VAR`, `$(cmd)` AND `` `cmd` `` in the body — including on
 * lines that start with `#`. A `#` inside a heredoc is not a comment; it is
 * literal text that still goes through expansion. So a comment written in
 * markdown habit:
 *
 *     # ... unroutable `.invalid` sentinel otherwise.
 *
 * makes bash run `.invalid`, print "command not found" to stderr, and splice
 * the (empty) output into the generated file. Caught live on 2026-07-19 in
 * scripts/aisha-cold-start.sh:2108 — the wipe run printed
 *   scripts/aisha-cold-start.sh: line 1603: .invalid: command not found
 * (bash attributes it to the heredoc START line, which is why it reads as a
 * phantom error 500 lines from the real defect) and .env.coolify line 505 came
 * out as "# the service is in the profile, unroutable  sentinel otherwise."
 *
 * That instance was cosmetic. The class is not: that heredoc is ~670 lines and
 * every backtick in it executes, so the blast radius is bounded only by what
 * someone happens to type in a comment.
 *
 * ── WHY BACKTICKS AND NOT $( ) ────────────────────────────────────────────
 * Both substitute. But `$(date -u ...)` in the same heredoc is DELIBERATE (it
 * stamps the generated header), so banning `$(` would need an allow-list — and
 * an allow-list is how gates rot. Backticks have no such tension: this repo
 * never uses them as substitution, only as markdown quoting in prose. "Unescaped
 * backtick in an unquoted heredoc" is therefore an invariant with no exceptions.
 *
 * ── ESCAPED BACKTICKS STAY LEGAL ──────────────────────────────────────────
 * scripts/init-new-tenant.sh writes \`npm run db:migrate\` inside a heredoc and
 * is CORRECT — the backslash makes it literal. The gate counts preceding
 * backslashes so \\\` (escaped backslash, then a LIVE backtick) is still caught.
 *
 * Related class — prose carrying metacharacters into a context that interprets
 * them:
 *   - Coolify $ -> $$ in Traefik label VALUES
 *     (src/tests/gates/coolify-traefik-label-substitution.gate.test.ts)
 *   - `$` in a SQL DO $$ body terminating the block early
 *     (aisha/db/seed/core/39_coolify_routing_doctrine.sql uses DO $seed$)
 *
 * Spousti se pres: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();

interface Violation {
  file: string;
  line: number;
  tag: string;
  text: string;
}

/** Shell scripts tracked by git (avoids node_modules / build output). */
function shellScripts(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "*.sh"], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/**
 * True when the backtick at `idx` is NOT backslash-escaped.
 * Counts the run of backslashes immediately before it: an ODD count escapes
 * the backtick, an EVEN count means the backslashes escaped each other and the
 * backtick is live.
 */
function isUnescaped(line: string, idx: number): boolean {
  let slashes = 0;
  for (let i = idx - 1; i >= 0 && line[i] === "\\"; i--) slashes++;
  return slashes % 2 === 0;
}

/**
 * Walk a script line by line tracking heredoc state.
 * Only UNQUOTED heredocs are inspected — `<<'TAG'` / `<<"TAG"` disable every
 * expansion, so prose inside them is inert and needs no escaping.
 */
export function findHeredocBacktickViolations(file: string, content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split("\n");

  let openTag: string | null = null;
  let stripTabs = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (openTag !== null) {
      const terminator = stripTabs ? line.replace(/^\t+/, "") : line;
      if (terminator === openTag) {
        openTag = null;
        continue;
      }
      for (let c = 0; c < line.length; c++) {
        if (line[c] === "`" && isUnescaped(line, c)) {
          violations.push({ file, line: i + 1, tag: openTag, text: line.trim() });
          break;
        }
      }
      continue;
    }

    // `<<<` is a here-STRING, not a heredoc — the char class after `<<` rejects it.
    const m = line.match(/<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/);
    if (m) {
      const quoted = m[2] !== "";
      stripTabs = m[1] === "-";
      openTag = m[3];
      if (quoted) {
        // Still need to consume the body to find the terminator, but nothing
        // inside is interpreted — mark it so the loop skips inspection.
        let j = i + 1;
        for (; j < lines.length; j++) {
          const t = stripTabs ? lines[j].replace(/^\t+/, "") : lines[j];
          if (t === openTag) break;
        }
        i = j;
        openTag = null;
      }
    }
  }

  return violations;
}

describe("Shell heredoc metacharacter gate", () => {
  test("no unescaped backtick inside an unquoted heredoc body", () => {
    const violations: Violation[] = [];
    for (const file of shellScripts()) {
      const content = readFileSync(join(ROOT, file), "utf-8");
      violations.push(...findHeredocBacktickViolations(file, content));
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  (heredoc <<${v.tag})\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `Found ${violations.length} unescaped backtick(s) inside unquoted heredoc bodies.\n` +
          `In \`<<TAG\` (unquoted) bash performs command substitution on the body — INCLUDING\n` +
          `lines starting with '#', which are NOT comments there. A markdown-style \`word\`\n` +
          `runs 'word' and splices its output into the generated file.\n\n` +
          `Fix: escape it (\\\`) or drop the quoting from the prose. Do NOT switch the heredoc\n` +
          `to <<'TAG' to silence this — these bodies rely on \${VAR} expansion.\n\n` +
          `Violations:\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });

  // Negative tests — a gate that cannot fail is not a gate.
  test("detector catches the real 2026-07-19 defect shape", () => {
    const sample = [
      "cat > \"$TMP\" <<HEADER",
      "# the service is in the profile, unroutable `.invalid` sentinel otherwise.",
      "HEADER",
    ].join("\n");
    const found = findHeredocBacktickViolations("sample.sh", sample);
    expect(found.map((v) => v.line)).toEqual([2]);
  });

  test("escaped backticks are legal (init-new-tenant.sh shape)", () => {
    const sample = [
      "cat > hook <<HOOK",
      "# Fires after every \\`npm run db:migrate\\` completes.",
      "HOOK",
    ].join("\n");
    expect(findHeredocBacktickViolations("sample.sh", sample)).toEqual([]);
  });

  test("an escaped backslash leaves the backtick live and is caught", () => {
    const sample = ["cat <<T", "path is C:\\\\ then `boom`", "T"].join("\n");
    expect(findHeredocBacktickViolations("sample.sh", sample)).toHaveLength(1);
  });

  test("quoted heredocs are inert and not flagged", () => {
    for (const tag of ["'DOC'", '"DOC"']) {
      const sample = [`cat <<${tag}`, "prose with `backticks` is literal here", "DOC"].join("\n");
      expect(findHeredocBacktickViolations("sample.sh", sample), tag).toEqual([]);
    }
  });

  test("backticks outside any heredoc are none of this gate's business", () => {
    const sample = ["ts=`date +%s`", "echo \"$ts\""].join("\n");
    expect(findHeredocBacktickViolations("sample.sh", sample)).toEqual([]);
  });

  test("<<- strips leading tabs when matching the terminator", () => {
    const sample = ["\tcat <<-T", "\tprose `boom` here", "\tT", "echo after"].join("\n");
    const found = findHeredocBacktickViolations("sample.sh", sample);
    expect(found.map((v) => v.line)).toEqual([2]);
  });

  test("here-strings (<<<) are not treated as heredocs", () => {
    const sample = ["grep x <<<\"$var\"", "echo `date`"].join("\n");
    expect(findHeredocBacktickViolations("sample.sh", sample)).toEqual([]);
  });
});
