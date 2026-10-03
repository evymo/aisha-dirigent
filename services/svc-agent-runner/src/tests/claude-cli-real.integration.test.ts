import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClaudeResult } from '../backends/claude-result.js';

/**
 * cli:claude-cli — REAL Claude Code execution + result capture (the twin of
 * codex-cli-real.integration.test.ts). Proves the first cli:<slug> tool actually
 * PERFORMS on the backend AISHA deems suitable (Anthropic / the Claude Code
 * subscription): the docker/agent-claude entrypoint drives a real autonomous
 * `claude -p` that does file work in a worktree and emits the SAME __result sentinel
 * the runner captures — one runner, one result contract, both CLI tools.
 *
 * Opt-in (real cost / real subscription): CLAUDE_INTEGRATION=1 + a credential
 * (CLAUDE_CODE_OAUTH_TOKEN for the subscription, or ANTHROPIC_API_KEY). Else
 * self-skips; the flag-set-without-credential case fails loud.
 *   CLAUDE_INTEGRATION=1 CLAUDE_CODE_OAUTH_TOKEN=… npx vitest run --root services/svc-agent-runner src/tests/claude-cli-real.integration.test.ts
 */

const HAS_CRED = !!process.env.CLAUDE_CODE_OAUTH_TOKEN || !!process.env.ANTHROPIC_API_KEY;
const ON = process.env.CLAUDE_INTEGRATION === '1' && HAS_CRED;
if (process.env.CLAUDE_INTEGRATION === '1' && !HAS_CRED) {
  throw new Error('CLAUDE_INTEGRATION=1 but no CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY — the claude real-exec lane is mis-wired.');
}
const RUN = ON ? describe : describe.skip;

const ENTRYPOINT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docker/agent-claude/entrypoint.sh',
);

RUN('cli:claude-cli — real Claude Code execution', () => {
  it('drives a real claude agent that does file work + emits the shared __result sentinel', () => {
    const work = mkdtempSync(join(tmpdir(), 'claude-real-'));
    let stdout = '';
    try {
      stdout = execFileSync('bash', [ENTRYPOINT], {
        env: {
          ...process.env,
          AISHA_WORKTREE: work,
          AISHA_RUN_ID: 'claude-real-test',
          CLAUDE_PERMISSION_MODE: 'acceptEdits',
          AISHA_GIT_PUSH: '0',
          AISHA_PROMPT:
            'Create a file named claude_ran.txt whose contents are exactly the text CLAUDE_DID_WORK and nothing else.',
        },
        encoding: 'utf8',
        timeout: 280_000,
      });
    } catch (err) {
      stdout = (err as { stdout?: string }).stdout ?? '';
    }

    // 1) the agent REALLY performed agentic work — it created the file with the content.
    const file = join(work, 'claude_ran.txt');
    expect(existsSync(file), 'claude must have created claude_ran.txt').toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('CLAUDE_DID_WORK');

    // 2) the runner's shared result contract captures it (same validateClaudeResult as codex-cli).
    const line = stdout.split('\n').reverse().find((l) => l.includes('"__result":true'));
    expect(line, 'agent-claude must emit the __result sentinel').toBeTruthy();
    const value = (JSON.parse(line as string) as { value: Record<string, unknown> }).value;
    const v = validateClaudeResult(value);
    expect(v.valid, JSON.stringify(value)).toBe(true);
    expect(value.ok).toBe(true);
    expect(value.exit_code).toBe(0);

    rmSync(work, { recursive: true, force: true });
  }, 300_000);
});
