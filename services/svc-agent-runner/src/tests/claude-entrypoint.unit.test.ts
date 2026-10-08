import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const entrypoint = resolve('../../docker/agent-claude/entrypoint.sh');
const temps: string[] = [];
afterEach(() => { for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(branch: string, rejectPush = false) {
  const root = mkdtempSync(join(tmpdir(), 'aisha-entrypoint-')); temps.push(root);
  const repo = join(root, 'repo'), remote = join(root, 'remote.git'), bin = join(root, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', remote); git('init');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(repo, 'CLAUDE.md'), 'project instructions\n'); git('add', '.'); git('commit', '-m', 'initial');
  git('remote', 'add', 'origin', remote);
  mkdirSync(join(repo, '.aisha'));
  writeFileSync(join(repo, '.aisha/run-context.md'), 'ephemeral context');
  writeFileSync(join(repo, '.aisha/story.json'), '{"prompt":"test"}');
  writeFileSync(join(repo, '.git/info/exclude'), '.aisha/run-context.md\n.aisha/story.json\n');
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nprintf "change\\n" > output.txt\n', { mode: 0o755 });
  if (rejectPush) writeFileSync(join(remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const run = () => spawnSync('bash', [entrypoint], {
    cwd: repo, encoding: 'utf8', timeout: 30000,
    env: { PATH: `${bin}:${process.env.PATH}`, AISHA_RUN_ID: 'test-run',
      AISHA_WORKTREE: repo, AISHA_PROMPT: 'test', AISHA_GIT_PUSH: '1', AISHA_BRANCH: branch,
      AGENT_GIT_TOKEN: '', EXEC_TIMEOUT_MS: '30000' },
  });
  return { run, git, remote };
}

function result(stdout: string) {
  const line = stdout.split('\n').find(line => line.startsWith('{"__result":true'));
  expect(line).toBeDefined();
  return JSON.parse(line!).value as { ok: boolean; exit_code: number };
}

describe('agent publication is bound to the run and reports real Git failures', () => {
  it('refuses main before executing Claude', () => {
    const f = fixture('main'); const r = f.run();
    expect(r.status).toBe(64); expect(result(r.stdout)).toEqual(expect.objectContaining({ ok: false, exit_code: 64 }));
    expect(f.git('status', '--porcelain')).toBe('');
  });
  it('publishes changes on its own branch without committing transient story context', () => {
    const f = fixture('aisha/run/test-run/capability/test'); const r = f.run();
    expect(r.status, r.stderr).toBe(0); expect(result(r.stdout).ok).toBe(true);
    expect(f.git('ls-tree', '-r', '--name-only', 'HEAD').split('\n')).toEqual(['CLAUDE.md', 'output.txt']);
    expect(f.git('--git-dir', f.remote, 'rev-parse', 'refs/heads/aisha/run/test-run/capability/test')).toBe(f.git('rev-parse', 'HEAD'));
  });
  it('a successful Claude process with a rejected push is still a failed run', () => {
    const f = fixture('aisha/run/test-run', true); const r = f.run();
    expect(r.status).not.toBe(0); expect(result(r.stdout).ok).toBe(false);
    expect(result(r.stdout).exit_code).toBe(r.status);
  });
});
