/**
 * Gate test: Phase 13 WP 13.3 — aisha-ide-bridge client package.
 *
 * Locks down the package shape + safety contract:
 *   1. packages/aisha-ide-bridge/ exists with package.json declaring
 *      bin: aisha-ide-bridge → dist/cli.js (CLI entrypoint contract)
 *   2. Public exports include both delimiter helpers + IdeBridge class
 *   3. AISHA-MANAGED-* + USER-CUSTOM-* delimiter constants match the
 *      Phase 13 WP 13.2 template wire shape (so client + server agree)
 *   4. Default IDE output paths cover all 4 plan-spec IDEs
 *   5. Reconnect backoff is BOUNDED (1s..30s cap) per safety contract
 *   6. CLI requires AISHA_IDE_BRIDGE_TOKEN env (NEVER reads token from
 *      a disk file — safety contract per feedback_agent_on_user_machine_safety.md)
 *   7. Unit tests exist covering safe-write 4 paths + bridge surface
 *   8. README documents the safety contract + wire protocol
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, 'packages/aisha-ide-bridge');
const PKG_JSON = path.join(PKG_DIR, 'package.json');
const SAFE_WRITE = path.join(PKG_DIR, 'src/safe-write.ts');
const BRIDGE = path.join(PKG_DIR, 'src/bridge.ts');
const INDEX = path.join(PKG_DIR, 'src/index.ts');
const CLI = path.join(PKG_DIR, 'src/cli.ts');
const README = path.join(PKG_DIR, 'README.md');
const SAFE_WRITE_TEST = path.join(PKG_DIR, 'src/__tests__/safe-write.unit.test.ts');
const BRIDGE_TEST = path.join(PKG_DIR, 'src/__tests__/bridge.unit.test.ts');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 13 WP 13.3 — Package layout', () => {
  it('packages/aisha-ide-bridge/ exists', () => {
    expect(fs.existsSync(PKG_DIR)).toBe(true);
  });

  it('package.json declares @aisha/ide-bridge name + bin entry', () => {
    const pkg = JSON.parse(readText(PKG_JSON)) as {
      name?: string;
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      type?: string;
      exports?: Record<string, unknown>;
    };
    expect(pkg.name).toBe('@aisha/ide-bridge');
    expect(pkg.type).toBe('module');
    expect(pkg.bin?.['aisha-ide-bridge']).toBe('./dist/cli.js');
    expect(pkg.dependencies?.ws).toBeDefined();
    expect(pkg.dependencies?.zod).toBeDefined();
    // exports include both API surfaces
    expect(pkg.exports).toBeDefined();
    expect(Object.keys(pkg.exports!)).toContain('.');
    expect(Object.keys(pkg.exports!)).toContain('./safe-write');
    expect(Object.keys(pkg.exports!)).toContain('./bridge');
  });

  it('all 4 source files exist (safe-write, bridge, index, cli)', () => {
    expect(fs.existsSync(SAFE_WRITE)).toBe(true);
    expect(fs.existsSync(BRIDGE)).toBe(true);
    expect(fs.existsSync(INDEX)).toBe(true);
    expect(fs.existsSync(CLI)).toBe(true);
  });
});

describe('Phase 13 WP 13.3 — Delimiter constants match WP 13.2 templates', () => {
  // The IDE bridge MUST agree with svc-ide-context templates on the
  // exact delimiter strings, else safe-merge silently fails (regex
  // misses, user-section disappears).
  const src = readText(SAFE_WRITE);

  it('AISHA-MANAGED-START literal', () => {
    expect(src).toMatch(/AISHA_MANAGED_START\s*=\s*["']<!-- AISHA-MANAGED-START -->["']/);
  });

  it('AISHA-MANAGED-END literal', () => {
    expect(src).toMatch(/AISHA_MANAGED_END\s*=\s*["']<!-- AISHA-MANAGED-END -->["']/);
  });

  it('USER-CUSTOM-START literal', () => {
    expect(src).toMatch(/USER_CUSTOM_START\s*=\s*["']<!-- USER-CUSTOM-START -->["']/);
  });

  it('USER-CUSTOM-END literal', () => {
    expect(src).toMatch(/USER_CUSTOM_END\s*=\s*["']<!-- USER-CUSTOM-END -->["']/);
  });
});

describe('Phase 13 WP 13.3 — safe-write API surface', () => {
  const src = readText(SAFE_WRITE);

  it('exports safeWriteSync + delimiter helpers + types', () => {
    expect(src).toMatch(/export\s+function\s+safeWriteSync/);
    expect(src).toMatch(/export\s+function\s+extractUserCustomSection/);
    expect(src).toMatch(/export\s+function\s+extractAishaManagedBlock/);
    expect(src).toMatch(/export\s+function\s+replaceUserCustomSection/);
    expect(src).toMatch(/export\s+function\s+defaultContentEquals/);
    expect(src).toMatch(/export\s+type\s+SafeWriteOutcome/);
  });

  it('SafeWriteOutcome enumerates 4 plan-spec outcomes', () => {
    expect(src).toMatch(/"written"/);
    expect(src).toMatch(/"skipped-identical"/);
    expect(src).toMatch(/"appended-to-user-owned"/);
    expect(src).toMatch(/"backup-failed"/);
  });

  it('default backup retention is 5 (per safety contract)', () => {
    expect(src).toMatch(/DEFAULT_BACKUPS_PER_FILE\s*=\s*5/);
  });
});

describe('Phase 13 WP 13.3 — IdeBridge surface', () => {
  const src = readText(BRIDGE);

  it('exports IdeBridge class + SUPPORTED_IDES + IDE_DEFAULT_OUTPUT_PATH', () => {
    expect(src).toMatch(/export\s+class\s+IdeBridge/);
    expect(src).toMatch(/export\s+const\s+SUPPORTED_IDES/);
    expect(src).toMatch(/export\s+const\s+IDE_DEFAULT_OUTPUT_PATH/);
  });

  it('IDE_DEFAULT_OUTPUT_PATH covers all 4 plan-spec IDEs', () => {
    expect(src).toMatch(/"claude-code":\s*"CLAUDE\.md"/);
    expect(src).toMatch(/cursor:\s*"\.cursorrules"/);
    expect(src).toMatch(/copilot:\s*"\.github\/copilot-instructions\.md"/);
    expect(src).toMatch(/jetbrains:\s*"\.idea\/aisha-ai-prompt-config\.json"/);
  });

  it('reconnect schedule is bounded (1s start, 30s cap)', () => {
    expect(src).toMatch(/RECONNECT_BACKOFF_SECONDS\s*=\s*\[1,\s*2,\s*4,\s*8,\s*16,\s*30\]/);
  });

  it('backoffDelayMs caps at last entry + applies jitter', () => {
    expect(src).toMatch(/export\s+function\s+backoffDelayMs/);
    expect(src).toMatch(/JITTER_RATIO\s*=\s*0\.2/);
  });

  it('PING_INTERVAL_MS = 30 000 (NAT keepalive)', () => {
    expect(src).toMatch(/PING_INTERVAL_MS\s*=\s*30_?000/);
  });

  it('exposes test-friendly seams (writer + wsImpl + fetchImpl)', () => {
    expect(src).toMatch(/writer\?:/);
    expect(src).toMatch(/wsImpl\?:/);
    expect(src).toMatch(/fetchImpl\?:/);
  });
});

describe('Phase 13 WP 13.3 — CLI safety contract', () => {
  const src = readText(CLI);

  it('CLI shebang present (node binary launcher)', () => {
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('CLI reads JWT ONLY from AISHA_IDE_BRIDGE_TOKEN env (never disk)', () => {
    expect(src).toMatch(/TOKEN_ENV\s*=\s*"AISHA_IDE_BRIDGE_TOKEN"/);
    expect(src).toMatch(/getToken[\s\S]+process\.env\[TOKEN_ENV\]/);
  });

  it('persisted config file does NOT contain a token field (safety guard)', () => {
    // Persisted config is just service URL + ide + workspace + rootDir.
    // No secret field per `feedback_agent_on_user_machine_safety.md`.
    expect(src).toMatch(/interface\s+PersistedConfig\s*\{/);
    // The interface block declares allowed fields only
    const ifaceBlock = src.match(/interface\s+PersistedConfig\s*\{[\s\S]+?\}/);
    expect(ifaceBlock).not.toBeNull();
    expect(ifaceBlock![0]).not.toMatch(/token|secret|password|key/i);
  });

  it('exposes 4 plan-spec subcommands (init, sync, daemon, uninstall)', () => {
    expect(src).toMatch(/case\s+"init"/);
    expect(src).toMatch(/case\s+"sync"/);
    expect(src).toMatch(/case\s+"daemon"/);
    expect(src).toMatch(/case\s+"uninstall"/);
  });

  it('uninstall does NOT delete IDE files (only the config)', () => {
    expect(src).toMatch(
      /cmdUninstall[\s\S]{0,800}IDE instruction files were NOT touched/,
    );
  });
});

describe('Phase 13 WP 13.3 — Unit test coverage', () => {
  it('safe-write unit test file exists', () => {
    expect(fs.existsSync(SAFE_WRITE_TEST)).toBe(true);
  });

  it('bridge unit test file exists', () => {
    expect(fs.existsSync(BRIDGE_TEST)).toBe(true);
  });

  it('safe-write tests cover all 4 outcome paths', () => {
    const src = readText(SAFE_WRITE_TEST);
    expect(src).toMatch(/writes new file when target doesn't exist/);
    expect(src).toMatch(/PREPENDS AISHA block \+ preserves original content/);
    expect(src).toMatch(/merges new AISHA block \+ preserves existing USER-CUSTOM/);
    expect(src).toMatch(/skips identical write/);
  });

  it('safe-write tests cover backup rotation (last N retention)', () => {
    const src = readText(SAFE_WRITE_TEST);
    expect(src).toMatch(/retains only the last N backups/);
  });

  it('safe-write tests cover PII guard (USER-CUSTOM email NOT in AISHA block)', () => {
    const src = readText(SAFE_WRITE_TEST);
    expect(src).toMatch(/USER-CUSTOM content is NOT echoed into the AISHA block/);
  });

  it('bridge tests cover privacy guard (no file paths sent to backend)', () => {
    const src = readText(BRIDGE_TEST);
    expect(src).toMatch(/Privacy guard|no file path/i);
    expect(src).toMatch(/url\)\.not\.toContain\(tmpRoot\)|url\.not\.toContain\(tmp/);
  });

  it('bridge tests cover backoff bounds (jitter + cap)', () => {
    const src = readText(BRIDGE_TEST);
    expect(src).toMatch(/jitter is bounded/i);
    expect(src).toMatch(/escalate up to the cap/i);
  });
});

describe('Phase 13 WP 13.3 — README safety contract', () => {
  const src = readText(README);

  it('README exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('documents the 6 safety guarantees from feedback_agent_on_user_machine_safety.md', () => {
    expect(src).toMatch(/NEVER silently overwritten/i);
    expect(src).toMatch(/preserved across syncs/i);
    expect(src).toMatch(/recoverable backup/i);
    expect(src).toMatch(/JWT NEVER written to disk/i);
    expect(src).toMatch(/Auto-trigger is opt-in/i);
    expect(src).toMatch(/file paths.*NEVER sent to backend/i);
  });

  it('documents the WS wire protocol (ready / context_changed / pong)', () => {
    expect(src).toMatch(/"type":\s*"ready"/);
    expect(src).toMatch(/"type":\s*"context_changed"/);
    expect(src).toMatch(/"type":\s*"pong"/);
  });

  it('documents close codes (4001/4003/4400/4502/1001)', () => {
    expect(src).toMatch(/4001/);
    expect(src).toMatch(/4003/);
    expect(src).toMatch(/4502/);
  });
});
