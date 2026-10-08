/**
 * Tvar požadavku na kontejner běhu (rada cb K1/K6/K7, T8) — jediné místo skládání.
 * Čisté funkce, žádný Docker: měří se výstup builderu a odmítnutí porušených invariantů.
 */
import { describe, expect, it } from 'vitest';
import { buildRunContainerBody, meshPromenneVProstredi, parseMemoryLimit, type RunContainerSpec } from '../backends/run-container-spec.js';

const ZAKLAD: RunContainerSpec = {
  image: 'aisha/plugin-exec:v1',
  network: 'inst-exec-runs',
  env: ['RUN_ID=r1', 'BROKER_URL=http://10.9.0.2:3031', 'BROKER_TOKEN=t'],
  user: '1000',
  pidsLimit: 128,
  memoryBytes: 512 * 1024 * 1024,
  cpuQuota: 50000,
  cpuPeriod: 100000,
  readonlyRootfs: true,
  tmpfs: { '/tmp': 'size=32m,noexec,nosuid' },
};

type Telo = {
  Image: string;
  User: string;
  Env: string[];
  NetworkingConfig: { EndpointsConfig: Record<string, unknown> };
  HostConfig: Record<string, unknown>;
};

describe('buildRunContainerBody — invarianty běhu', () => {
  it('T8: PidsLimit > 0, číselný User ≠ 0, CapDrop ALL, no-new-privileges, kořen jen pro čtení, jen síť běhů', () => {
    const t = buildRunContainerBody(ZAKLAD) as Telo;
    expect(t.User).toBe('1000');
    expect(t.HostConfig['PidsLimit']).toBe(128);
    expect(t.HostConfig['CapDrop']).toEqual(['ALL']);
    expect(t.HostConfig['SecurityOpt']).toEqual(['no-new-privileges:true']);
    expect(t.HostConfig['ReadonlyRootfs']).toBe(true);
    expect(t.HostConfig['NetworkMode']).toBe('inst-exec-runs');
    expect(Object.keys(t.NetworkingConfig.EndpointsConfig)).toEqual(['inst-exec-runs']);
    expect(t.HostConfig['Tmpfs']).toEqual({ '/tmp': 'size=32m,noexec,nosuid' });
    expect(t.HostConfig).not.toHaveProperty('Binds');
    expect(t.HostConfig).not.toHaveProperty('Runtime');
    expect(t.Env).toEqual(ZAKLAD.env);
  });

  it('kata runtime a připojení jdou do HostConfig, invarianty zůstávají', () => {
    const t = buildRunContainerBody({ ...ZAKLAD, runtime: 'kata-fc', binds: ['/w:/work:rw'], readonlyRootfs: false }) as Telo;
    expect(t.HostConfig['Runtime']).toBe('kata-fc');
    expect(t.HostConfig['Binds']).toEqual(['/w:/work:rw']);
    expect(t.HostConfig['PidsLimit']).toBe(128);
    expect(t.HostConfig['CapDrop']).toEqual(['ALL']);
  });

  it.each(['0', 'root', 'node', '0:0', '1000:0', '', ' 1000', '-1', '1000:root'])(
    'uživatel %j se odmítne (root nebo jméno, které si obraz namapuje)',
    (user) => {
      expect(() => buildRunContainerBody({ ...ZAKLAD, user })).toThrow(/uživatel/);
    },
  );

  it.each(['1000', '10001', '1000:1000'])('číselný uživatel %j projde', (user) => {
    expect((buildRunContainerBody({ ...ZAKLAD, user }) as Telo).User).toBe(user);
  });

  it.each([0, -1, 1.5, Number.NaN])('PidsLimit %j se odmítne (Docker by bral 0/NaN jako „bez stropu“)', (pidsLimit) => {
    expect(() => buildRunContainerBody({ ...ZAKLAD, pidsLimit })).toThrow(/PidsLimit/);
  });

  it('K1: prostředí s NB_* (klíč k mesh síti) se odmítne — i malými písmeny', () => {
    expect(() => buildRunContainerBody({ ...ZAKLAD, env: [...ZAKLAD.env, 'NB_SETUP_KEY=k'] })).toThrow(/mesh/);
    expect(() => buildRunContainerBody({ ...ZAKLAD, env: [...ZAKLAD.env, 'NB_MANAGEMENT_URL=https://m'] })).toThrow(/mesh/);
    expect(() => buildRunContainerBody({ ...ZAKLAD, env: [...ZAKLAD.env, 'nb_setup_key=k'] })).toThrow(/mesh/);
    expect(meshPromenneVProstredi(['A=1', 'NB_X=2', 'XNB_Y=3'])).toEqual(['NB_X']);
  });

  it('chybějící síť nebo obraz se odmítne', () => {
    expect(() => buildRunContainerBody({ ...ZAKLAD, network: '' })).toThrow(/síť/);
    expect(() => buildRunContainerBody({ ...ZAKLAD, image: '' })).toThrow(/obraz/);
  });
});

describe('parseMemoryLimit (sdílený, dřív 3× zkopírovaný)', () => {
  it.each([
    ['512m', 512 * 1024 * 1024],
    ['1g', 1024 * 1024 * 1024],
    ['64k', 64 * 1024],
    ['1048576', 1048576],
    ['', 256 * 1024 * 1024],
    ['garbage', 256 * 1024 * 1024],
  ])('%j → %d', (vstup, bajty) => {
    expect(parseMemoryLimit(vstup)).toBe(bajty);
  });
});
