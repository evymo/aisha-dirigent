/**
 * Cesty a klon běhu claude_cli_task — kontejner vs hostitel.
 *
 * ⛔ NAMĚŘENO 2026-09-23 (docker inspect, jen čtení): exec tří instancí na jednom
 * stroji sdílel doslovné /var/lib/aisha/agent-runs a /srv/aisha/base-repo, a runner
 * každé instance, jejíž identita nebyla „aisha", psal do cesty, která v jeho
 * kontejneru vůbec nebyla namountovaná. Příčina: jedna proměnná sloužila jako cesta
 * v kontejneru runneru (mkdir, git) i jako cesta HOSTITELE v Binds dítěte.
 *
 * Kontrakt: runner pracuje v PEVNÉM adresáři kontejneru (cíl svazku — Coolify `${`
 * v cíli odmítá), dítě dostane TÝŽ adresář pod hostitelskou cestou instance.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({ config: {} }));
const { cestyBehu, klonRepa } = await import('../backends/claude-cli.js');

import { pripojeniBehu } from '../backends/svazek-behu.js';
import { vetevBehu } from '../backends/vetev-behu.js';

const KONTEJNER = '/var/lib/agent-runs';

describe('run paths and measured Docker mounts', () => {
  it('uses only the runner directory, without a second host-path declaration', () => {
    expect(cestyBehu('run-1', { agentRunsContainerDir: KONTEJNER })).toEqual({ kontejner: '/var/lib/agent-runs/run-1' });
  });
  it('rejects paths escaping the run directory', () => {
    for (const bad of ['../x', 'a/b', '.git', '..', '', ' ', 'r;rm']) {
      expect(() => cestyBehu(bad, { agentRunsContainerDir: KONTEJNER })).toThrow();
    }
  });
  it('passes the actual Coolify volume, including its per-run subpath', () => {
    expect(pripojeniBehu([{ Type: 'volume', Name: 'instance_a_runs', Destination: KONTEJNER, RW: true }], KONTEJNER, 'r1'))
      .toEqual({ Type: 'volume', Source: 'instance_a_runs', Target: '/work', ReadOnly: false, VolumeOptions: { Subpath: 'r1' } });
  });
  it('keeps existing bind deployments working through their measured mount', () => {
    expect(pripojeniBehu([{ Type: 'bind', Source: '/srv/instance-a/runs/', Destination: KONTEJNER, RW: true }], KONTEJNER, 'r1'))
      .toEqual({ Type: 'bind', Source: '/srv/instance-a/runs/r1', Target: '/work', ReadOnly: false });
  });
  it('refuses missing, read-only, unsupported and unnamed mounts', () => {
    for (const mounts of [[], [{ Type: 'volume', Name: 'runs', Destination: KONTEJNER, RW: false }],
      [{ Type: 'tmpfs', Destination: KONTEJNER, RW: true }], [{ Type: 'volume', Destination: KONTEJNER, RW: true }]]) {
      expect(() => pripojeniBehu(mounts, KONTEJNER, 'r1')).toThrow();
    }
  });
});

describe('run branch namespace', () => {
  it('keeps requested main and labels below the run namespace', () => {
    expect(vetevBehu('r1', 'main')).toBe('aisha/run/r1/main');
    expect(vetevBehu('r1')).toBe('aisha/run/r1');
    expect(vetevBehu('r1', 'aisha/run/r1/fix')).toBe('aisha/run/r1/fix');
  });
  it('rejects ambiguous or invalid git refs', () => {
    for (const ref of ['../main', '.git', 'topic.lock', 'a..b', 'x@{1}', 'a b', 'x:main', '/main', 'main/']) {
      expect(() => vetevBehu('r1', ref)).toThrow();
    }
  });
});

describe('klon repa pro běh', () => {
  const REMOTE = 'https://git.example.invalid/org/repo.git';
  const CIL = '/var/lib/agent-runs/r1';

  it('token jen v env procesu — nikdy v argumentech (ps) ani v URL (.git/config klonu vidí agent)', () => {
    const k = klonRepa(REMOTE, CIL, 'TAJNY-TOKEN-123');
    expect(k.args).toEqual(['clone', '--filter=blob:none', '--no-checkout', '--', REMOTE, CIL]);
    expect(k.args.join(' ')).not.toContain('TAJNY-TOKEN-123');
    expect(k.env).toMatchObject({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: 'Authorization: token TAJNY-TOKEN-123',
      GIT_TERMINAL_PROMPT: '0',
    });
  });

  it('bez tokenu žádná hlavička a git nečeká na heslo (fail-fast místo visícího běhu)', () => {
    const k = klonRepa(REMOTE, CIL, '');
    expect(k.env).toEqual({ GIT_TERMINAL_PROMPT: '0' });
  });

  it('remote se předává za `--` — nemůže se vydávat za přepínač gitu', () => {
    const k = klonRepa('--upload-pack=touch /tmp/x', CIL, '');
    expect(k.args.indexOf('--')).toBeLessThan(k.args.indexOf('--upload-pack=touch /tmp/x'));
  });
});
