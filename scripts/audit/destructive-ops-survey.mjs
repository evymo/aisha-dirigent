#!/usr/bin/env node
/**
 * destructive-ops-survey.mjs — survey every committed script for
 * destructive operations and verify each one is gated by `DRY_RUN`.
 *
 * Why: 2026-05-26 incident — `aisha-cold-start.sh --wipe --dry-run` actually
 * deleted 15/16 Coolify apps because the wipe phase checked `$WIPE` but
 * not `$DRY_RUN`. The cold-start-dry-run-safety.gate.test.ts gate locks
 * that specific bug; this script generalises the pattern to find ANY
 * destructive operation that lacks the dry-run guard.
 *
 * Detects (per category):
 *   A. Coolify API DELETE        — `coolify_api DELETE`, `fetch(..., method: "DELETE")`
 *                                  against `/applications/`, `/envs/`, etc.
 *   B. Docker destructive ops    — `docker rm -f`, `docker volume rm`,
 *                                  `docker network rm`, `docker compose down -v`
 *   C. Filesystem destruction    — `rm -rf` outside /tmp, `find ... -delete`
 *   D. Database destruction      — `dropdb`, `DROP DATABASE`, `DROP TABLE`,
 *                                  `psql ... -c "DROP"`
 *   E. Git destruction           — `git push --force`, `git reset --hard`,
 *                                  `git clean -f`, `git branch -D`
 *
 * For each detected destructive line, the script reports:
 *   PROTECTED  — line is inside an `if [ "$DRY_RUN" = "0" ]` branch (good)
 *   UNGUARDED  — line runs unconditionally regardless of DRY_RUN (BAD)
 *   ALLOWLIST  — script is on EXPLICIT_DESTRUCTIVE_SCRIPTS allowlist
 *                (entire-purpose destructive scripts like
 *                `coolify-wipe-all.mjs`)
 *
 * Usage:
 *   node scripts/audit/destructive-ops-survey.mjs          # human report
 *   node scripts/audit/destructive-ops-survey.mjs --json   # machine-readable
 *
 * Gate-tested by `src/tests/gates/destructive-ops-dry-run-coverage.gate.test.ts`.
 * Future: surface via pre-push hook for new destructive ops.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const JSON_OUT = process.argv.includes('--json');

/**
 * Scripts that are EXPLICITLY destructive by purpose — gate skips them.
 * Each entry must have a one-line rationale comment.
 */
const EXPLICIT_DESTRUCTIVE_SCRIPTS = new Set([
  // Wipes the whole AISHA stack on demand — destructive is the JOB
  'scripts/coolify-wipe-all.mjs',
  // Single-app delete CLI helper
  'scripts/coolify-app-delete.mjs',
  // Workbench build scripts — rm -rf is intentional build-time cleanup (not operational)
  'workbench/build.sh',
  'workbench/build/install_bundled_extensions.sh',
  // CI upgrade-path gate — drops/recreates its OWN throwaway probe DB (aisha_upgrade_probe); destructive on the test fixture is the JOB
  'scripts/db/verify-upgrade-apply.sh',
  // Init n8n: rm -rf jen na vlastní pracovní kopie balíčku (<cíl>.novy/.stary) ve svazku n8n-data — výměna verze JE úloha; rozbitý balíček funkční nepřepíše
  'infra/n8n/doruc-uzly-aisha.sh',
  // E2E úklidu evidence adres: `docker rm -f` / `docker volume rm` jen na VLASTNÍ jednorázový kontejner a svazek (e2e-edge-*), které si sám založil
  'scripts/edge-uklid-e2e.sh',
]);

/**
 * Skip these paths entirely (test fixtures, archived, vendor).
 */
const SKIP_PATHS = [
  /^trash\//,
  /^archive\//,
  /^packages\/insight\//,
  /^node_modules\//,
  /^dist\//,
  /^docs\//,
  /\.md$/,
  /\.lock$/,
  /package-lock\.json$/,
  /\.png$|\.jpg$|\.svg$|\.ico$/,
  /__tests__\//,
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /^src\/tests\//,
];

/**
 * Destructive patterns. Each: { id, category, regex, hint }.
 * The regex is matched per-line, ignoring comment lines.
 */
const PATTERNS = [
  // A. Coolify API DELETE
  {
    id: 'coolify-api-delete',
    category: 'coolify-api',
    regex: /coolify_api\s+DELETE\b/,
    hint: 'Coolify DELETE call',
  },
  {
    id: 'fetch-method-delete-coolify',
    category: 'coolify-api',
    // fetch(..., { method: "DELETE" }) where URL contains /applications/ or /envs/
    regex: /method\s*:\s*['"]DELETE['"][\s\S]*?\/(applications|envs|deployments|servers)\//,
    hint: 'fetch DELETE to Coolify resource',
  },
  {
    id: 'curl-X-delete-coolify',
    category: 'coolify-api',
    regex: /curl\s+[^\n]*-X\s+DELETE[^\n]*\/(applications|envs|deployments|servers)\b/,
    hint: 'curl -X DELETE to Coolify resource',
  },
  // B. Docker destructive
  {
    id: 'docker-rm-f',
    category: 'docker',
    regex: /\bdocker\s+rm\s+(-f|--force)\b/,
    hint: 'docker rm -f',
  },
  {
    id: 'docker-volume-rm',
    category: 'docker',
    regex: /\bdocker\s+volume\s+rm\b/,
    hint: 'docker volume rm',
  },
  {
    id: 'docker-network-rm',
    category: 'docker',
    regex: /\bdocker\s+network\s+rm\b/,
    hint: 'docker network rm',
  },
  {
    id: 'docker-compose-down-v',
    category: 'docker',
    regex: /\bdocker\s+compose\s+down\s+[^\n]*(-v|--volumes)\b/,
    hint: 'docker compose down -v (purges named volumes)',
  },
  // C. Filesystem destruction
  {
    id: 'rm-rf-non-tmp',
    category: 'filesystem',
    // rm -rf <path> where path doesn't start with /tmp, $TMPDIR, /var/tmp
    // (heuristic — false positives possible for relative paths)
    regex: /\brm\s+-rf?\s+(?!\/tmp|\$TMPDIR|\/var\/tmp|\$\{?TMPDIR)/,
    hint: 'rm -rf on non-/tmp path',
  },
  // D. Database destruction
  {
    id: 'dropdb',
    category: 'database',
    regex: /\bdropdb\s+\w/,
    hint: 'dropdb CLI',
  },
  {
    id: 'sql-drop-database',
    category: 'database',
    regex: /DROP\s+DATABASE\b/i,
    hint: 'SQL DROP DATABASE',
  },
  {
    id: 'sql-drop-table-no-if-exists',
    category: 'database',
    // DROP TABLE without "IF EXISTS" — risky in migrations
    regex: /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i,
    hint: 'SQL DROP TABLE without IF EXISTS',
  },
  // E. Git destruction
  {
    id: 'git-push-force',
    category: 'git',
    regex: /\bgit\s+push\s+[^\n]*(--force(?:-with-lease)?|-f)\b/,
    hint: 'git push --force',
  },
  {
    id: 'git-reset-hard',
    category: 'git',
    regex: /\bgit\s+reset\s+--hard\b/,
    hint: 'git reset --hard',
  },
  {
    id: 'git-clean-f',
    category: 'git',
    regex: /\bgit\s+clean\s+-f/,
    hint: 'git clean -f',
  },
  {
    id: 'git-branch-D',
    category: 'git',
    regex: /\bgit\s+branch\s+-D\b/,
    hint: 'git branch -D (force-delete)',
  },
];

function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter((p) => p.length > 0)
    .filter((p) => !SKIP_PATHS.some((re) => re.test(p)))
    .filter((p) => {
      // Only scan script-like files
      if (p.startsWith('scripts/')) return true;
      if (p.startsWith('.github/workflows/')) return true;
      if (p.startsWith('.husky/')) return true;
      if (p.endsWith('.sh') || p.endsWith('.mjs') || p.endsWith('.js')) return true;
      if (p.endsWith('.yml') || p.endsWith('.yaml')) return true;
      return false;
    });
}

function stripComments(content) {
  // Best-effort: remove shell `#` comments and JS `//` line comments.
  // Multi-line `/* ... */` and SQL `-- ...` are partially handled.
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) return ''; // shell/yaml comment
      if (trimmed.startsWith('//')) return ''; // js comment
      if (trimmed.startsWith('*')) return ''; // jsdoc body
      if (trimmed.startsWith('/*')) return ''; // jsdoc open
      if (trimmed.startsWith('--')) return ''; // sql comment
      return line;
    })
    .join('\n');
}

/**
 * Heuristic check whether a destructive line is inside a DRY_RUN-aware
 * conditional branch. Accepted shapes:
 *
 *   1. `if [ "$DRY_RUN" = "0" ]; then <destructive> fi`
 *   2. `if [ "$DRY_RUN" != "1" ]; then <destructive> fi`
 *   3. `if [ "$DRY_RUN" = "1" ]; then <preview> else <destructive> fi`
 *      → the destructive call lives AFTER an `else` whose matching `if`
 *        checks DRY_RUN
 *   4. JS/TS equivalents (`if (!DRY_RUN)`, `if (DRY_RUN === "0")`, etc.)
 *
 * Scan up to 80 lines upward looking for a guard. The line must be in a
 * branch that's only entered when DRY_RUN is false.
 */
function isUnderDryRunGuard(lines, lineIdx) {
  const start = Math.max(0, lineIdx - 80);
  // Track basic block depth via braces — naive but works for JS/TS.
  let openBraceDepth = 0;
  // Track when we walked past an `else` so we can verify the matching if
  // checks DRY_RUN.
  let sawElse = false;
  for (let i = lineIdx - 1; i >= start; i--) {
    const line = lines[i];
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;
    openBraceDepth += closes - opens;
    if (openBraceDepth < 0) break;

    // Direct positive guard
    //
    // ⛔ UVOZOVKA SMÍ BÝT ESCAPOVANÁ (`\"`). Stráž uvnitř YAML double-quoted
    // skaláru (compose `entrypoint: "…"`) je v syrovém textu zapsaná jako
    //     if [ \"$$DRY_RUN\" = \"0\" ]
    // což je TÝŽ KÓD, jen jinak zapsaný. Bez `\\?` ho detektor neviděl a
    // hlásil UNGUARDED na `docker rm -f`, které stráž MĚLO (naměřeno 2026-09-05
    // na infra/ci-runner). Táž třída jako vzor `restart: "no"`, který četl
    // komentář: vzor musí počítat s kontextem, ve kterém text bydlí.
    // `$DRY_RUN` i `${DRY_RUN:-…}`: skript se `set -u` na holé expanzi
    // NENASTAVENÉ proměnné spadne, takže bezpečný zápis je právě ten
    // s výchozí hodnotou. Detektor, který uznává jen holou expanzi, by
    // autory tlačil k tvaru, který se pod `set -u` rozbije.
    // `\$\$?`: Compose escapuje `$` jako `$$` (jinak by proměnnou spolkla
    // interpolace compose při parsování). Guard v `command:` bloku compose
    // souboru je tedy v SYROVÉM textu `"$${DRY_RUN:-0}"` — bez tohohle
    // rozšíření je skutečná ochrana pro měřidlo neviditelná a detektor by
    // autory tlačil k zápisu, který se v compose rozbije (táž třída jako
    // komentář o `set -u` výš). Naměřeno 2026-08-13: netinit měl plnohodnotný
    // DRY_RUN guard a survey ho hlásil UNGUARDED.
    if (
      /if\s+\[\s+\\?"\$\$?\{?DRY_RUN(:-[^}]*)?\}?\\?"\s+=\s+\\?"0\\?"\s+\]/.test(line) ||
      /if\s+\[\s+\\?"\$\$?\{?DRY_RUN(:-[^}]*)?\}?\\?"\s+!=\s+\\?"1\\?"\s+\]/.test(line) ||
      /if\s+\(\s*DRY_RUN\s*===?\s*["']0["']\s*\)/.test(line) ||
      /if\s+\(\s*!\s*DRY_RUN\s*\)/.test(line) ||
      /if\s+\(\s*!\s*isDryRun\s*\)/.test(line) ||
      /if\s*\(\s*process\.env\.DRY_RUN\s*!==?\s*['"]?1['"]?\s*\)/.test(line)
    ) {
      return true;
    }

    // Else of a DRY_RUN==1 check (preview-then-real pattern)
    if (/^\s*else\s*$/.test(line) || /^\s*}\s*else\s*{/.test(line)) {
      sawElse = true;
      continue;
    }
    if (
      sawElse &&
      (/if\s+\[\s+\\?"\$\$?\{?DRY_RUN(:-[^}]*)?\}?\\?"\s+=\s+\\?"1\\?"\s+\]/.test(line) ||
        /if\s+\(\s*DRY_RUN\s*===?\s*["']1["']\s*\)/.test(line) ||
        /if\s+\(\s*DRY_RUN\s*\)/.test(line) ||
        /if\s+\(\s*isDryRun\s*\)/.test(line) ||
        /if\s*\(\s*process\.env\.DRY_RUN\s*===?\s*['"]?1['"]?\s*\)/.test(line))
    ) {
      return true;
    }
  }

  // Early-return / early-exit guard pattern: scan a wider window for
  //   if [ "$DRY_RUN" = "1" ]; then return 0; fi
  // ALSO accepts:
  //   if [ "$DRY_RUN" = "1" ]; then exit 0; fi
  //   if (DRY_RUN) return … (TS/JS)
  //   if (process.env.DRY_RUN === '1') return …
  // The destructive line is implicitly protected if the function early-returned.
  const wideStart = Math.max(0, lineIdx - 200);
  for (let i = lineIdx - 1; i >= wideStart; i--) {
    const window = lines.slice(i, Math.min(i + 4, lineIdx)).join(' ');
    if (
      /if\s+\[\s+"\$\$?\{?DRY_RUN(:-[^}]*)?\}?"\s+=\s+"1"\s+\][\s\S]*?then[\s\S]*?\b(return|exit)\b\s*\d?/m.test(window) ||
      /if\s+\(\s*(DRY_RUN|process\.env\.DRY_RUN[^)]*)\s*\)[\s\S]*?\breturn\b/.test(window)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * `rm -rf "$VAR"` where $VAR is a process-allocated temp path — i.e. VAR was
 * assigned from `mktemp` (with or without -d) somewhere in the same file. This is
 * the canonical safe temp-cleanup idiom (often in a trap): it can only ever delete
 * a directory this process just created under $TMPDIR, never operational data. The
 * literal-path arm of the rm -rf pattern already exempts `/tmp`/`$TMPDIR`/`/var/tmp`;
 * this is the same exemption for the far more common `mktemp`-into-a-variable form.
 * Tightly scoped: only a bare `"$VAR"`/`${VAR}`/`$VAR` target whose exact name has
 * an `mktemp` assignment in this file — a real `rm -rf "$DATA_DIR"` is still flagged.
 */
function isMktempBackedRm(line, lines) {
  // Capture the var name after `rm -rf` with an optional opening quote / `${`. The
  // \w+ stops at the first non-word char (quote / `}` / `/`), so no trailing anchor is
  // needed — this also matches the trap-embedded form `trap 'rm -rf "$TMP"' EXIT`.
  const m = line.match(/\brm\s+-rf?\s+["']?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/);
  if (!m) return false;
  const varName = m[1];
  // Assignment of that exact var from mktemp: `VAR=$(mktemp…)`, `local d="$(mktemp -d)"`, …
  const assignRe = new RegExp(`^\\s*(?:local\\s+|export\\s+|readonly\\s+)?${varName}=.*\\bmktemp\\b`);
  return lines.some((l) => assignRe.test(l));
}

/**
 * `rm -rf /etc/netbird/…` — clearing the NetBird agent's own config directory.
 * This is the mesh sidecar's documented SELF-HEAL RE-ENROLL idiom, run at
 * container start (see the `command:` block of every `netbird-agent`/mesh
 * sidecar): wipe any STALE peer identity so the injected setup-key enrolls the
 * peer cleanly on (re)start. It is safe by CONSTRUCTION, in the same class as
 * the regex's existing `/tmp`/`$TMPDIR` literal-path exemption and
 * `isMktempBackedRm`:
 *   - `/etc/netbird` is an ephemeral daemon-CONFIG dir INSIDE the container
 *     (peer identity + state), re-provisioned from the setup-key every start —
 *     NOT a mounted volume, NOT operational/user data,
 *   - the container filesystem is itself ephemeral (recreated on redeploy),
 *   - DRY_RUN is meaningless in a container `command:` block (the entrypoint
 *     always runs), so the gate's dry-run shape can never apply here.
 * Tightly scoped to the `/etc/netbird` path — a real `rm -rf /etc/<anything-
 * else>` or an operator script is still flagged. Recognising the CLASS (not a
 * per-file allowlist) reclassifies ALL such sidecars uniformly and ratchets the
 * baseline DOWN, instead of carrying each instance as a raw unguarded count.
 */
function isEphemeralNetbirdConfigCleanup(line) {
  return /\brm\s+-rf?\s+\/etc\/netbird\b/.test(line);
}

function classify(file, lineNo, lines) {
  if (EXPLICIT_DESTRUCTIVE_SCRIPTS.has(file)) return 'ALLOWLIST';
  if (isUnderDryRunGuard(lines, lineNo - 1)) return 'PROTECTED';
  if (isMktempBackedRm(lines[lineNo - 1], lines)) return 'PROTECTED';
  if (isEphemeralNetbirdConfigCleanup(lines[lineNo - 1])) return 'PROTECTED';
  return 'UNGUARDED';
}

/**
 * Skip lines that aren't actually invoking the destructive op:
 *   - echo/printf/console.log/HITS+= strings carrying the literal as
 *     warning text (the aisha-advise-bash-risk.sh hook lists destructive
 *     patterns in HITS+= arrays — those are documentation, not invocation)
 *   - trap '...' EXIT lines (cleanup of process-allocated tmp — by
 *     definition runs only on script exit, not part of normal flow)
 *   - Lines clearly inside a `"..." ... command` quoted string
 *
 * If the line starts with one of these prefixes, the regex match isn't a
 * real invocation, so we skip it.
 */
function isLiteralStringMention(line) {
  const t = line.trimStart();
  if (/^echo\b/.test(t)) return true;
  if (/^printf\b/.test(t)) return true;
  if (/^HITS\+=/.test(t)) return true; // aisha-advise-bash-risk warning array
  if (/^console\.(log|warn|error)\b/.test(t)) return true;
  if (/^trap\b/.test(t)) return true; // trap '...' EXIT cleanup of own tmp
  // Pattern-catalog metadata of THIS very scanner (the PATTERNS array below
  // defines destructive shapes as `hint:`/`regex:` string/regex literals — e.g.
  // `hint: 'docker rm -f'`). Those are documentation of what to look for, never
  // an invocation; without this the survey flags its own definitions (12 self-
  // matches). An object-property line `hint:`/`regex:` is never a shell command.
  if (/^hint\s*:/.test(t)) return true;
  if (/^regex\s*:/.test(t)) return true;
  return false;
}

function scanFile(file) {
  let raw;
  try {
    raw = readFileSync(join(ROOT, file), 'utf8');
  } catch {
    return [];
  }
  const stripped = stripComments(raw);
  const lines = stripped.split('\n');
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (isLiteralStringMention(line)) continue;
    for (const p of PATTERNS) {
      if (p.regex.test(line)) {
        findings.push({
          file,
          line: i + 1,
          patternId: p.id,
          category: p.category,
          hint: p.hint,
          snippet: line.trim().slice(0, 140),
          status: classify(file, i + 1, lines),
        });
      }
    }
  }
  return findings;
}

async function main() {
  const files = listTrackedFiles();
  const allFindings = [];
  for (const f of files) {
    allFindings.push(...scanFile(f));
  }

  if (JSON_OUT) {
    const payload = JSON.stringify(
      {
        total: allFindings.length,
        byStatus: countBy(allFindings, (f) => f.status),
        byCategory: countBy(allFindings, (f) => f.category),
        findings: allFindings,
      },
      null,
      2,
    );
    await new Promise((resolve) => process.stdout.write(payload + '\n', resolve));
    process.exit(0);
  }

  const unguarded = allFindings.filter((f) => f.status === 'UNGUARDED');
  const protectedOps = allFindings.filter((f) => f.status === 'PROTECTED');
  const allowlist = allFindings.filter((f) => f.status === 'ALLOWLIST');

  console.log('=== destructive-ops-survey ===');
  console.log(
    `total: ${allFindings.length}  |  unguarded: ${unguarded.length}  |  protected: ${protectedOps.length}  |  allowlist: ${allowlist.length}`,
  );
  console.log('');
  console.log('--- by category (UNGUARDED only) ---');
  const byCat = countBy(unguarded, (f) => f.category);
  for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(15)} ${n}`);
  }
  console.log('');
  console.log('--- UNGUARDED destructive ops (these are the risk) ---');
  for (const f of unguarded) {
    console.log(`  [${f.category}] ${f.file}:${f.line} — ${f.hint}`);
    console.log(`    ${f.snippet}`);
  }
  process.exit(0);
}

function countBy(arr, fn) {
  const m = {};
  for (const x of arr) {
    const k = fn(x);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

main().catch((e) => {
  process.stderr.write(`destructive-ops-survey FAILED: ${e?.stack ?? e}\n`);
  process.exit(2);
});
