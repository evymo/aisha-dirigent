/**
 * CLASS gate — env-file sourcing under `set -e` must be guarded (word-split safe)
 *
 * WHY (a whole FAMILY, not one bug):
 *   `.env-prod-backup` / `.env.coolify` legitimately hold UNQUOTED multi-word secrets —
 *   notably COSMOS_SIGNER_MNEMONIC (a BIP39 phrase). When a script running under
 *   `set -euo pipefail` sources such a file, the phrase word-splits and one of its words
 *   (e.g. "dish") runs as a command → "command not found" (exit 127) → the WHOLE script
 *   aborts mid-run. On the cold-start's create step this destroyed-but-did-not-recreate
 *   the stack (incident 2026-07-17, coolify-story-init.sh). This has recurred: it was
 *   first fixed for .env.coolify in coolify-deploy-init.sh (commit 3737e1c1), then bit
 *   coolify-story-init.sh, and the same unguarded pattern still lurks in other scripts.
 *
 *   Instance gates pin one spelling; they can't catch the NEXT unguarded source. This
 *   gate catches the CLASS: every `source`/`.` of a cold-start env file, in a script that
 *   sets `-e`, MUST be wrapped in an explicit `set +e` guard region. A `&& . file &&`
 *   chain is NOT sufficient (story-init proved it still aborts) — the guard must be an
 *   explicit `set +e` (optionally `set +u`) preceding the source with no intervening
 *   `set -e` before the source line.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPTS = join(ROOT, "scripts");

// The env files whose values can be unquoted multi-word (and thus word-split on source).
const ENV_FILE_RE = /(\.env-prod-backup|\.env\.coolify|\/domains\.env|config\/domains\.env)/;
// A REAL `source`/`.` command targeting one of those files — anchored to a command
// position (start of line, or after `&&`/`||`/`;`/`then`/`do`/`{`), so mentions of the
// filename inside printf/echo/warn strings do NOT match.
const SOURCE_RE =
  /(?:^|&&|\|\||;|\bthen\b|\bdo\b|\{)\s*(?:source|\.)\s+["']?[^"'\s;|&]*(?:\.env-prod-backup|\.env\.coolify|domains\.env)/;
// Extra guard against the printf/echo false positive: if the token appears inside a
// quoted string that starts earlier on the line (printf '...'), skip.
const IN_MESSAGE_RE = /\b(printf|echo|warn|err|info|fail|ok|banner|log)\b[^\n]*["'][^\n]*(\.env-prod-backup|\.env\.coolify|domains\.env)/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".sh")) out.push(p);
  }
  return out;
}

/** Is line `i` (0-based) a guarded source? Look back for a `set +e` after the last `set -e`. */
function isGuarded(lines: string[], i: number): boolean {
  for (let j = i - 1; j >= 0 && j >= i - 25; j -= 1) {
    const l = lines[j];
    if (/\bset\s+\+e\b|\bset\s+\+eu\b|\bset\s+\+e\s+\+u\b/.test(l)) return true; // guard opened
    if (/\bset\s+-e(uo)?\b|\bset\s+-eu\b|set\s+-e\s/.test(l)) return false; // re-armed before source
  }
  return false;
}

describe("CLASS: env-file sourcing under set -e must be guarded", () => {
  const shFiles = walk(SCRIPTS);

  test("every source of a cold-start env file in a `set -e` script is set-+e guarded", () => {
    const violations: string[] = [];

    // Flag EVERY unguarded env-file source — not only in scripts that arm `set -e`
    // themselves. A lib (scripts/lib/*.sh) sourced INTO a `set -euo pipefail` caller runs
    // under the caller's -e, so the word-split abort strikes there too (resolve-domains-env.sh
    // is exactly this shape). The guard is cheap and always correct, so require it everywhere.
    for (const file of shFiles) {
      const src = readFileSync(file, "utf-8");
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim().startsWith("#")) continue;
        if (!ENV_FILE_RE.test(line)) continue;
        if (IN_MESSAGE_RE.test(line)) continue; // filename mentioned inside a printf/echo string
        const m = line.match(SOURCE_RE);
        if (!m) continue;
        // Same-line guard: `... set +e ... . file` (guard opened before the source on this line).
        const sameLineGuard = /\bset\s+\+e[u]?\b|\bset\s+\+e\s+\+u\b/.test(line.slice(0, m.index ?? 0));
        if (!sameLineGuard && !isGuarded(lines, i)) {
          violations.push(`${file.replace(ROOT + "/", "")}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      }
    }

    expect(
      violations,
      "Unguarded env-file source under `set -e` — a multi-word unquoted value (e.g. " +
        "COSMOS_SIGNER_MNEMONIC) word-splits and aborts the whole script. Wrap the source in an " +
        "explicit `set +e` (and `set +u`) guard region:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });
});
