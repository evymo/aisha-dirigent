/**
 * Gate test: Phase 13 WP 13.5 — IDE bridge user-settings respect.
 *
 * Locks the 5-invariant safety contract from
 * `feedback_agent_on_user_machine_safety.md` against the existing
 * @aisha/ide-bridge implementation (shipped PR #155 / WP 13.3) AND
 * cross-checks the operator runbook at
 * `docs/security/IDE_BRIDGE_USER_SAFETY_RUNBOOK.md` against the actual
 * code. Future refactors that drift either direction (code changes
 * without runbook update, or runbook claims unsupported by code)
 * will fail this gate.
 *
 * Distinct from `wp-13-3-ide-bridge.gate.test.ts`:
 *   - WP 13.3 gate = structural lock (package layout, exports, delimiter
 *     constants, CLI subcommands)
 *   - WP 13.5 gate (this file) = SAFETY-CONTRACT lock (the 5 invariants
 *     are documented, the runbook matches the code's actual constants,
 *     unit tests exercise each invariant end-to-end)
 *
 * Why both gates instead of folding WP 13.5 into WP 13.3:
 *   - WP 13.3 is owned by the package author (changes to bridge.ts /
 *     safe-write.ts trigger that gate)
 *   - WP 13.5 is owned by Security + DevOps (changes to the runbook
 *     OR to security-relevant constants like backup retention trigger
 *     this gate). Separation keeps the failure mode clear: "code
 *     drift" vs "doc drift" vs "contract drift".
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const RUNBOOK = path.join(ROOT, 'docs/security/IDE_BRIDGE_USER_SAFETY_RUNBOOK.md');
const SAFE_WRITE = path.join(ROOT, 'packages/aisha-ide-bridge/src/safe-write.ts');
const BRIDGE = path.join(ROOT, 'packages/aisha-ide-bridge/src/bridge.ts');
const CLI = path.join(ROOT, 'packages/aisha-ide-bridge/src/cli.ts');
const SAFE_WRITE_TEST = path.join(
  ROOT,
  'packages/aisha-ide-bridge/src/__tests__/safe-write.unit.test.ts',
);
const BRIDGE_TEST = path.join(
  ROOT,
  'packages/aisha-ide-bridge/src/__tests__/bridge.unit.test.ts',
);

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 13 WP 13.5 — runbook exists + structurally correct', () => {
  const md = readText(RUNBOOK);

  it('runbook file exists at the canonical path', () => {
    expect(fs.existsSync(RUNBOOK)).toBe(true);
  });

  it('runbook has snapshot date + owner header (per docs/security style)', () => {
    expect(md).toMatch(/^# IDE Bridge — user-machine safety runbook/m);
    expect(md).toMatch(/Snapshot \d{4}-\d{2}-\d{2}/);
    expect(md).toMatch(/Owner:.*Security/);
  });

  it('runbook explicitly names the 5-invariant contract', () => {
    expect(md).toMatch(/five.invariant safety contract/i);
  });

  it('runbook attributes the contract back to the memory file', () => {
    expect(md).toMatch(/feedback_agent_on_user_machine_safety\.md/);
  });
});

describe('Phase 13 WP 13.5 — Invariant #1: detect user-owned content', () => {
  const md = readText(RUNBOOK);
  const code = readText(SAFE_WRITE);
  const test = readText(SAFE_WRITE_TEST);

  it('runbook documents the "appended-to-user-owned" outcome', () => {
    expect(md).toMatch(/appended-to-user-owned/);
  });

  it('safe-write.ts implements the outcome value', () => {
    expect(code).toMatch(/"appended-to-user-owned"/);
  });

  it('unit test exercises the prepend behaviour against a real fs', () => {
    expect(test).toMatch(/PREPENDS AISHA block \+ preserves original content/);
  });
});

describe('Phase 13 WP 13.5 — Invariant #2: backup before write', () => {
  const md = readText(RUNBOOK);
  const code = readText(SAFE_WRITE);
  const test = readText(SAFE_WRITE_TEST);

  it('runbook documents backup directory + filename shape', () => {
    expect(md).toMatch(/\.aisha\/backups\//);
    expect(md).toMatch(/<original-filename>\.<ISO-timestamp>\.bak/);
  });

  it('runbook claims retention of 5 backups per file', () => {
    expect(md).toMatch(/last\s*5|5\s+backups\s+per/i);
  });

  it('safe-write.ts default retention matches the runbook claim', () => {
    // The runbook MUST stay in sync with the code constant. If you bump
    // DEFAULT_BACKUPS_PER_FILE, update the runbook in the same PR.
    expect(code).toMatch(/DEFAULT_BACKUPS_PER_FILE\s*=\s*5/);
  });

  it('unit test exercises backup rotation behaviour', () => {
    expect(test).toMatch(/retains only the last N backups/);
  });

  it('runbook documents the "backup-failed" abort outcome', () => {
    expect(md).toMatch(/backup-failed/);
    expect(md).toMatch(/does\s+not\s+write\s+the\s+IDE\s+file/i);
  });

  it('safe-write.ts implements the backup-failed abort path', () => {
    expect(code).toMatch(/"backup-failed"/);
  });
});

describe('Phase 13 WP 13.5 — Invariant #3: auto-trigger is opt-in', () => {
  const md = readText(RUNBOOK);
  const cli = readText(CLI);

  it('runbook documents that no daemon starts on install', () => {
    expect(md).toMatch(/no daemon starts|opt-in|never starts automatically/i);
  });

  it('CLI requires an explicit subcommand (no default daemon spawn)', () => {
    // The CLI must dispatch subcommands; never auto-start a daemon
    // simply because the binary was invoked without args.
    expect(cli).toMatch(/case\s+"daemon"/);
    expect(cli).toMatch(/case\s+"init"/);
  });

  it('package.json declares NO postinstall / preinstall lifecycle scripts', () => {
    const pkgPath = path.join(ROOT, 'packages/aisha-ide-bridge/package.json');
    const pkg = JSON.parse(readText(pkgPath)) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    // postinstall / preinstall would auto-run on `npm install` — that
    // breaks invariant #3 (opt-in). Forbid both unconditionally.
    expect(scripts.postinstall, 'postinstall script would auto-run — breaks opt-in invariant').toBeUndefined();
    expect(scripts.preinstall, 'preinstall script would auto-run — breaks opt-in invariant').toBeUndefined();
  });
});

describe('Phase 13 WP 13.5 — Invariant #4: privacy guard', () => {
  const md = readText(RUNBOOK);
  const bridgeSrc = readText(BRIDGE);
  const bridgeTest = readText(BRIDGE_TEST);

  it('runbook lists what the bridge DOES send (user_id + workspaceId)', () => {
    expect(md).toMatch(/user_id|user\s+id/i);
    expect(md).toMatch(/workspaceId|workspace\s+id/i);
  });

  it('runbook lists what the bridge does NOT send (file paths, repo, content)', () => {
    expect(md).toMatch(/never sends file paths/i);
  });

  it('bridge URL constructor only references known wire-protocol params', () => {
    // The bridge.ts URL constructors should only ever embed workspaceId
    // and ide, never file paths / repo names / content. Quick negative
    // scan: no fs.cwd(), no rootDir, no outputPath in URL templates.
    const urlLines = bridgeSrc.split('\n').filter((l) => /\$\{.*\}/.test(l) && /url|URL|\/instructions|\/subscribe|\/context/.test(l));
    for (const line of urlLines) {
      expect(line, 'bridge URL must not embed file paths or repo names').not.toMatch(/rootDir|outputPath|process\.cwd/);
    }
  });

  it('bridge unit test verifies the privacy guard end-to-end', () => {
    expect(bridgeTest).toMatch(/Privacy guard|no file path/i);
  });
});

describe('Phase 13 WP 13.5 — Invariant #5: uninstall reversibility', () => {
  const md = readText(RUNBOOK);
  const cli = readText(CLI);

  it('runbook documents that uninstall does NOT delete IDE files', () => {
    expect(md).toMatch(/IDE instruction files were NOT touched/);
  });

  it('runbook documents how to manually scrub if desired', () => {
    expect(md).toMatch(/scrub the bridge.s footprint|fully scrub/i);
  });

  it('CLI uninstall message matches the runbook claim verbatim', () => {
    // The runbook quotes the exact stderr message. Drift means either
    // the runbook lies or the code regressed — both block this gate.
    expect(cli).toMatch(/IDE instruction files were NOT touched/);
  });

  it('CLI uninstall only deletes the config file', () => {
    // Find the cmdUninstall function body and verify it only unlinks
    // the config path, not any IDE output path.
    const match = cli.match(/function\s+cmdUninstall[^{]*\{[\s\S]+?\n\}/);
    expect(match, 'cmdUninstall function not found').not.toBeNull();
    const body = match![0];
    expect(body).toMatch(/unlinkSync\(CONFIG_PATH\)/);
    // Negative: must NOT unlink anything that smells like an output file.
    expect(body, 'uninstall must not touch IDE output paths').not.toMatch(
      /unlinkSync\([^)]*outputPath|unlinkSync\([^)]*ide\)/,
    );
  });
});

describe('Phase 13 WP 13.5 — runbook references back to enforcing artefacts', () => {
  const md = readText(RUNBOOK);

  it('runbook names the WP 13.3 structural gate', () => {
    expect(md).toMatch(/wp-13-3-ide-bridge\.gate\.test\.ts/);
  });

  it('runbook names this WP 13.5 gate (self-reference)', () => {
    expect(md).toMatch(/wp-13-5-user-settings-respect\.gate\.test\.ts/);
  });

  it('runbook names the unit-test file', () => {
    expect(md).toMatch(/safe-write\.unit\.test\.ts/);
  });

  it('runbook has acceptance checklist for adding a 5th IDE adapter', () => {
    // Future IDE adapters (Zed, Helix, etc.) must follow the same
    // safety contract — checklist gives reviewers a concrete go/no-go list.
    expect(md).toMatch(/Acceptance checklist|new IDE adapters/i);
  });

  it('runbook documents the recovery procedure (restore from backup)', () => {
    expect(md).toMatch(/restore from backup|Recovery procedures/i);
    expect(md).toMatch(/cp\s+.+\.aisha\/backups\//);
  });
});
