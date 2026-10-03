import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClaudeResult } from '../backends/claude-result.js';

/**
 * cli:codex-cli — REAL OpenAI Codex execution + result capture.
 *
 * Proves the SECOND cli:<slug> tool actually PERFORMS on the backend AISHA deems
 * suitable (OpenAI), not just that it is selectable: the docker/agent-codex
 * entrypoint drives a real autonomous `codex exec` that does file work in a worktree
 * and emits the SAME machine-readable __result sentinel the runner captures for
 * cli:claude-cli — so one runner + one result contract drive both CLI tools.
 *
 * Opt-in (real cost): CODEX_INTEGRATION=1 + OPENAI_API_KEY. Else self-skips; the
 * flag-set-without-key case fails loud so a mis-wired lane never paints hollow-green.
 *   CODEX_INTEGRATION=1 OPENAI_API_KEY=… npx vitest run --root services/svc-agent-runner src/tests/codex-cli-real.integration.test.ts
 */

const ON = process.env.CODEX_INTEGRATION === '1' && !!process.env.OPENAI_API_KEY;
if (process.env.CODEX_INTEGRATION === '1' && !process.env.OPENAI_API_KEY) {
  throw new Error('CODEX_INTEGRATION=1 but OPENAI_API_KEY is unset — the codex real-exec lane is mis-wired.');
}
const RUN = ON ? describe : describe.skip;

const ENTRYPOINT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docker/agent-codex/entrypoint.sh',
);

RUN('cli:codex-cli — real OpenAI Codex execution', () => {
  it('drives a real codex agent that does file work + emits the shared __result sentinel', () => {
    const work = mkdtempSync(join(tmpdir(), 'codex-real-'));
    let stdout = '';
    try {
      stdout = execFileSync('bash', [ENTRYPOINT], {
        env: {
          ...process.env,
          AISHA_WORKTREE: work,
          AISHA_RUN_ID: 'codex-real-test',
          CODEX_SANDBOX: 'workspace-write',
          AISHA_GIT_PUSH: '0',
          AISHA_PROMPT:
            'Create a file named codex_ran.txt whose contents are exactly the text CODEX_DID_WORK and nothing else. Do not print anything else.',
        },
        encoding: 'utf8',
        timeout: 280_000,
      });
    } catch (err) {
      // codex non-zero still emits the sentinel via the EXIT trap — capture stdout for the assertions.
      stdout = (err as { stdout?: string }).stdout ?? '';
    }

    // 1) the agent REALLY performed agentic work — it created the file with the content.
    const file = join(work, 'codex_ran.txt');
    expect(existsSync(file), 'codex must have created codex_ran.txt').toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('CODEX_DID_WORK');

    // 2) the runner's shared result contract captures it (same validateClaudeResult as claude-cli).
    const line = stdout.split('\n').reverse().find((l) => l.includes('"__result":true'));
    expect(line, 'agent-codex must emit the __result sentinel').toBeTruthy();
    const value = (JSON.parse(line as string) as { value: Record<string, unknown> }).value;
    const v = validateClaudeResult(value);
    expect(v.valid, JSON.stringify(value)).toBe(true);
    expect(value.ok).toBe(true);
    expect(value.exit_code).toBe(0);
    expect(value.tool).toBe('codex-cli');

    rmSync(work, { recursive: true, force: true });
  }, 300_000);
});
