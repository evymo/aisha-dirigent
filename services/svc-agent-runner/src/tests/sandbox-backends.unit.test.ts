/**
 * Běh pluginu přes Docker i Kata (rada cb T1, T4, T8, M9) nad falešným Docker API.
 *
 * Měří se skutečný požadavek `containers/create`, který backend pošle: prostředí bez
 * klíče k mesh síti, BROKER_URL = relé brány runneru, meze procesu, uživatel, jen síť
 * běhů — u Dockeru i u Kata (dřív kata skládala vlastní kopii bez mezí).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDockerJSON, mockDockerRequest, mockDockerStart, mockZajistiCestu } = vi.hoisted(() => ({
  mockDockerJSON: vi.fn(),
  mockDockerRequest: vi.fn(),
  mockDockerStart: vi.fn(),
  mockZajistiCestu: vi.fn(),
}));

vi.mock('../backends/docker-http.js', () => ({
  dockerJSON: mockDockerJSON,
  dockerRequest: mockDockerRequest,
  dockerStart: mockDockerStart,
}));
// Síť běhů + připojení runneru měří zajistiCestuKBrokeru (testy: exec-sit-pripojeni).
vi.mock('../broker-proxy.js', () => ({ zajistiCestuKBrokeru: mockZajistiCestu }));
vi.mock('../config.js', () => ({
  config: {
    dockerSocket: '/var/run/docker.sock',
    dockerApiVersion: 'v1.46',
    dockerExecNetwork: 'inst-exec-runs',
    execMemoryLimit: '512m',
    execCpuQuota: 50000,
    execCpuPeriod: 100000,
    execPidsLimit: 128,
    execRunUser: '1000',
    kataGrpcEndpoint: '',
    agentImageAllowlist: '',
    pluginBrokerUrl: 'http://backend.mesh.test:3029',
  },
}));

import { DockerBackend } from '../backends/docker.js';
import { KataBackend } from '../backends/kata.js';
import type { RunInput } from '../backends/index.js';

const INPUT: RunInput = {
  runId: 'run-1',
  kind: 'plugin-exec',
  image: 'aisha/plugin-exec:v1',
  brokerToken: 'broker-jwt',
  payload: { plugin_code: 'return 1', tenant_id: 't' },
  timeoutMs: 1000,
};

type Telo = { User: string; Env: string[]; NetworkingConfig: { EndpointsConfig: Record<string, unknown> }; HostConfig: Record<string, unknown> };

function teloCreate(): Telo {
  const volani = mockDockerJSON.mock.calls.find((c) => String(c[1]).endsWith('/containers/create'));
  expect(volani, 'containers/create se nezavolal').toBeDefined();
  return volani![2] as Telo;
}

beforeEach(() => {
  mockDockerJSON.mockReset().mockImplementation(async (_m: string, cesta: string) => {
    if (cesta.endsWith('/containers/create')) return { Id: 'c1' };
    if (cesta.includes('/wait')) return { StatusCode: 0 };
    throw new Error('neočekávané volání ' + cesta);
  });
  mockDockerRequest.mockReset().mockResolvedValue({ status: 200, body: '{"__result":true,"value":1}\n' });
  mockDockerStart.mockReset().mockResolvedValue(undefined);
  mockZajistiCestu.mockReset().mockResolvedValue('http://inst-plugin-broker:3031');
});

describe.each([
  ['DockerBackend', () => new DockerBackend(), undefined],
  ['KataBackend', () => new KataBackend(), 'kata-dragonball'],
] as const)('%s — požadavek na kontejner běhu pluginu', (_jmeno, backend, runtime) => {
  const input = runtime ? { ...INPUT, profile: 'kata-dragonball' } : INPUT;

  it('T1: Env bez NB_*; BROKER_URL = broker-proxy runneru, ne broker (kotva: BROKER_TOKEN je)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('žádné odchozí volání'));
    try {
      await backend().execute(input);
      const t = teloCreate();
      expect(t.Env).toContain('BROKER_TOKEN=broker-jwt');
      expect(t.Env.filter((e) => /^NB_/i.test(e))).toEqual([]);
      expect(t.Env).toContain('BROKER_URL=http://inst-plugin-broker:3031');
      expect(t.Env.join('\n')).not.toContain('backend.mesh.test');
      expect(t.Env.some((e) => /^https?_proxy=/i.test(e))).toBe(false); // plugin nemá výstup — jen broker
      expect(mockZajistiCestu).toHaveBeenCalledTimes(1); // síť změřena u TOHOTO běhu
      expect(fetchSpy).not.toHaveBeenCalled(); // správa mesh sítě nedostala žádné volání
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('T8: PidsLimit, číselný User ≠ root, CapDrop ALL, kořen jen pro čtení, tmpfs noexec, jen síť běhů', async () => {
    await backend().execute(input);
    const t = teloCreate();
    expect(t.User).toBe('1000');
    expect(t.HostConfig['PidsLimit']).toBe(128);
    expect(t.HostConfig['CapDrop']).toEqual(['ALL']);
    expect(t.HostConfig['SecurityOpt']).toEqual(['no-new-privileges:true']);
    expect(t.HostConfig['ReadonlyRootfs']).toBe(true);
    expect(t.HostConfig['Tmpfs']).toEqual({ '/tmp': 'size=32m,noexec,nosuid' });
    expect(t.HostConfig['NetworkMode']).toBe('inst-exec-runs');
    expect(Object.keys(t.NetworkingConfig.EndpointsConfig)).toEqual(['inst-exec-runs']);
    expect(t.HostConfig).not.toHaveProperty('Binds');
    if (runtime) expect(t.HostConfig['Runtime']).toBe(runtime);
    else expect(t.HostConfig).not.toHaveProperty('Runtime');
  });

  it('T4: síť běhů odmítnuta → chyba se jménem sítě, containers/create se NEZAVOLÁ', async () => {
    mockZajistiCestu.mockRejectedValueOnce(new Error("síť běhů 'inst-exec-runs': NENÍ uzavřená (Internal=false)"));
    await expect(backend().execute(input)).rejects.toThrow(/inst-exec-runs.*NENÍ uzavřená/);
    expect(mockDockerJSON.mock.calls.some((c) => String(c[1]).endsWith('/containers/create'))).toBe(false);
    expect(mockDockerStart).not.toHaveBeenCalled();
  });

  it('payloadEnv z routes/runs.ts má přednost: velký payload do ENV nejde (vyzvedne si ho přes proxy)', async () => {
    await backend().execute({ ...input, payloadEnv: [] });
    expect(teloCreate().Env.some((e) => e.startsWith('PLUGIN_PAYLOAD='))).toBe(false);
    mockDockerJSON.mockClear();
    await backend().execute(input);
    expect(teloCreate().Env.some((e) => e.startsWith('PLUGIN_PAYLOAD='))).toBe(true);
  });

  it('kontejner se po běhu smaže i při chybě startu', async () => {
    mockDockerStart.mockRejectedValueOnce(new Error('start => 404'));
    await expect(backend().execute(input)).rejects.toThrow(/start/);
    expect(mockDockerRequest).toHaveBeenCalledWith('DELETE', '/v1.46/containers/c1?force=true');
  });
});
