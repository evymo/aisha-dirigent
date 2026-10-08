/**
 * claude_cli_task v uzavřené síti běhů (2026-10-06, volba A) nad falešným Docker API.
 *
 * Běh Claude Code smí ven jen přes broker-proxy runneru: dostane HTTPS_PROXY s tokenem běhu
 * (výčet cílů z konfigurace povolený na ten token), BROKER_URL na proxy, žádný klíč k mesh síti;
 * meze procesu a uživatel z runneru.
 * Nedeklarovaný model = běh se nespustí DŘÍV, než vznikne pracovní strom.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mockDockerJSON: vi.fn(),
  mockDockerRequest: vi.fn(),
  mockDockerStart: vi.fn(),
  mockSpawn: vi.fn(),
  proxy: {
    zajistiCestuKBrokeru: vi.fn(),
    brokerUrlProBeh: vi.fn(() => 'http://inst-plugin-broker:3031'),
    proxyUrlProKlonRunneru: vi.fn(() => 'http://run:broker-jwt@172.18.0.2:3031'),
    proxyUrlProBeh: vi.fn((token: string) => `http://run:${token}@inst-plugin-broker:3031`),
    povolVystupBehu: vi.fn(),
  },
  cfg: {} as Record<string, unknown>,
  overVystup: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: h.mockSpawn }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  cp: vi.fn(async () => undefined),
  chmod: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  appendFile: vi.fn(async () => undefined),
}));
vi.mock('../backends/docker-http.js', () => ({
  dockerJSON: h.mockDockerJSON,
  dockerRequest: h.mockDockerRequest,
  dockerStart: h.mockDockerStart,
  mountyRunneru: vi.fn(async () => [{ Type: 'volume', Name: 'inst_agent-runs', Destination: '/var/lib/agent-runs', RW: true }]),
}));
vi.mock('../broker-proxy.js', () => h.proxy);
// Měření cílů ochranou SSRF (DNS) se v testu dosazuje — vlastnost měří egress-policy.unit.test.ts.
vi.mock('../egress-policy.js', async (orig) => ({ ...(await orig<typeof import('../egress-policy.js')>()), overVystupBehu: h.overVystup }));
vi.mock('../credentials.js', () => ({
  credentialNameForRuntime: async () => 'AGENT_CLAUDE_OAUTH_TOKEN',
  credentials: { getMany: async () => ({ AGENT_CLAUDE_OAUTH_TOKEN: h.cfg.agentClaudeOauthToken ?? null, ANTHROPIC_API_KEY: h.cfg.anthropicApiKey ?? null }) },
}));
vi.mock('../config.js', () => ({ config: h.cfg }));

import { ClaudeCliBackend } from '../backends/claude-cli.js';
import type { RunInput } from '../backends/index.js';

const ZAKLAD_CFG = {
  dockerApiVersion: 'v1.46',
  dockerExecNetwork: 'inst-exec-runs',
  execMemoryLimit: '1g',
  execCpuQuota: 50000,
  execCpuPeriod: 100000,
  claudePidsLimit: 1024,
  claudeRunUser: '10001',
  agentImageAllowlist: '',
  agentRunsContainerDir: '/var/lib/agent-runs',
  agentRunsHostDir: '/var/lib/inst/agent-runs',
  agentAuthMode: 'auto',
  agentClaudeOauthToken: 'oauth-token',
  claudeHomeHostPath: '',
  localLlmBaseUrl: '',
  localLlmModel: '',
  anthropicBaseUrl: 'https://model.example.test/v1',
  anthropicApiKey: '',
  claudeModel: '',
  claudePermissionMode: 'acceptEdits',
  agentGitPush: false,
  agentGatewayUrl: 'https://relay.example.test',
  agentMcpToken: '',
  agentGitRemote: 'https://forge.example.test/org/repo.git',
  agentGitToken: '',
  npmRegistryUrl: 'https://npm.example.test/',
};

const INPUT: RunInput = {
  runId: 'run-c1',
  kind: 'claude_cli_task',
  image: 'aisha-agent-claude:test',
  brokerToken: 'broker-jwt',
  payload: {},
  timeoutMs: 1000,
  inputs: { prompt: 'udělej to' },
};

function fakeProces(code = 0) {
  const p = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  setTimeout(() => p.emit('close', code), 0);
  return p;
}

type Telo = { User: string; Env: string[]; WorkingDir: string; NetworkingConfig: { EndpointsConfig: Record<string, unknown> }; HostConfig: Record<string, unknown> };
const teloCreate = (): Telo => h.mockDockerJSON.mock.calls.find((c) => String(c[1]).endsWith('/containers/create'))![2] as Telo;
const env = (t: Telo, klic: string) => t.Env.find((e) => e.startsWith(klic + '='))?.slice(klic.length + 1);

beforeEach(() => {
  for (const k of Object.keys(h.cfg)) delete h.cfg[k];
  Object.assign(h.cfg, ZAKLAD_CFG);
  h.mockSpawn.mockReset().mockImplementation((_cmd: string, args: string[]) => {
    const p = fakeProces(0);
    if (args.includes('rev-parse')) queueMicrotask(() => p.stdout.emit('data', Buffer.from('a'.repeat(40) + '\n')));
    return p;
  });
  h.mockDockerJSON.mockReset().mockImplementation(async (_m: string, cesta: string) => {
    if (cesta.endsWith('/containers/create')) return { Id: 'cc1' };
    if (cesta.includes('/wait')) return { StatusCode: 0 };
    throw new Error('neočekávané volání ' + cesta);
  });
  h.mockDockerRequest.mockReset().mockResolvedValue({ status: 204, body: '' });
  h.mockDockerStart.mockReset().mockResolvedValue(undefined);
  h.proxy.zajistiCestuKBrokeru.mockReset().mockResolvedValue('http://inst-plugin-broker:3031');
  h.overVystup.mockReset().mockResolvedValue(undefined);
  h.proxy.povolVystupBehu.mockReset();
  h.proxy.proxyUrlProBeh.mockClear();
});

describe('ClaudeCliBackend.prepare — jediná cesta ven je broker-proxy runneru', () => {
  it('HTTP(S)_PROXY (obě velikosti) s tokenem běhu, BROKER_URL na proxy, žádné NB_* (kotva: BROKER_TOKEN)', async () => {
    const ctx = await new ClaudeCliBackend().prepare(INPUT);
    const t = teloCreate();
    const proxy = 'http://run:broker-jwt@inst-plugin-broker:3031';
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) expect(env(t, k), k).toBe(proxy);
    expect(env(t, 'BROKER_URL')).toBe('http://inst-plugin-broker:3031');
    expect(env(t, 'BROKER_TOKEN')).toBe('broker-jwt');
    expect(env(t, 'npm_config_registry')).toBe('https://npm.example.test/');
    expect(t.Env.filter((e) => /^NB_/i.test(e))).toEqual([]);
    expect(h.proxy.zajistiCestuKBrokeru).toHaveBeenCalledTimes(1); // síť změřena u TOHOTO běhu
    await new ClaudeCliBackend().monitor(ctx);
  });

  it('výstup povolený na TOKEN běhu = hostitelé z konfigurace běhu (model, relé, forge, registr) — nic navíc', async () => {
    const ctx = await new ClaudeCliBackend().prepare(INPUT);
    expect(h.proxy.povolVystupBehu).toHaveBeenCalledTimes(1);
    const [token, cile, runId] = h.proxy.povolVystupBehu.mock.calls[0]!;
    expect(token).toBe('broker-jwt');
    expect(runId).toBe('run-c1'); // run_id do logu výstupu
    expect(cile).toEqual([
      { host: 'model.example.test', port: 443 },
      { host: 'relay.example.test', port: 443 },
      { host: 'forge.example.test', port: 443 },
      { host: 'npm.example.test', port: 443 },
    ]);
    await new ClaudeCliBackend().monitor(ctx);
  });

  it('local_llm: model = AGENT_LOCAL_LLM_URL (ne ANTHROPIC_BASE_URL); http model se nespustí', async () => {
    Object.assign(h.cfg, { agentClaudeOauthToken: '', localLlmBaseUrl: 'https://llm.example.test:8443', anthropicBaseUrl: '' });
    const ctx = await new ClaudeCliBackend().prepare(INPUT);
    const cile = h.proxy.povolVystupBehu.mock.calls[0]![1] as Array<{ host: string }>;
    expect(cile[0]).toEqual({ host: 'llm.example.test', port: 8443 });
    expect(env(teloCreate(), 'ANTHROPIC_BASE_URL')).toBe('https://llm.example.test:8443');
    await new ClaudeCliBackend().monitor(ctx);
    Object.assign(h.cfg, { localLlmBaseUrl: 'http://llm.example.test:8000' });
    h.mockSpawn.mockClear();
    await expect(new ClaudeCliBackend().prepare(INPUT)).rejects.toThrow(/AGENT_LOCAL_LLM_URL.*https/);
    expect(h.mockSpawn).not.toHaveBeenCalled();
  });

  it('meze z runneru: PidsLimit, User 10001, CapDrop ALL, jen síť běhů', async () => {
    const ctx = await new ClaudeCliBackend().prepare(INPUT);
    const t = teloCreate();
    expect(t.User).toBe('10001');
    expect(t.HostConfig['PidsLimit']).toBe(1024);
    expect(t.HostConfig['CapDrop']).toEqual(['ALL']);
    expect(t.HostConfig['NetworkMode']).toBe('inst-exec-runs');
    expect(Object.keys(t.NetworkingConfig.EndpointsConfig)).toEqual(['inst-exec-runs']);
    expect(t.HostConfig['ReadonlyRootfs']).toBe(false);
    expect(t.WorkingDir).toBe('/work');
    expect(t.HostConfig['Mounts']).toEqual([{ Type: 'volume', Source: 'inst_agent-runs', Target: '/work', ReadOnly: false, VolumeOptions: { Subpath: 'run-c1' } }]);
    const clone = h.mockSpawn.mock.calls.find((c) => (c[1] as string[]).includes('clone'));
    expect(clone?.[2].env.https_proxy).toBe('http://run:broker-jwt@172.18.0.2:3031');
    expect(env(t, 'AISHA_BRANCH')).toBe('aisha/run/run-c1');
    await new ClaudeCliBackend().monitor(ctx);
  });

  it('nedeklarovaný model → výjimka DŘÍV, než vznikne pracovní strom (žádný git, žádný kontejner, žádný výstup)', async () => {
    Object.assign(h.cfg, { anthropicBaseUrl: '' });
    await expect(new ClaudeCliBackend().prepare(INPUT)).rejects.toThrow(/adresa modelu není deklarovaná \(ANTHROPIC_BASE_URL\)/);
    expect(h.mockSpawn).not.toHaveBeenCalled();
    expect(h.mockDockerJSON).not.toHaveBeenCalled();
    expect(h.proxy.povolVystupBehu).not.toHaveBeenCalled();
  });

  it('cíl, který proxy nepustí (mesh / soukromá adresa), shodí přípravu PŘED pracovním stromem', async () => {
    h.overVystup.mockRejectedValueOnce(new Error('AGENT_GATEWAY_URL vede na 100.64.0.7:443, kam broker-proxy běh nepustí'));
    await expect(new ClaudeCliBackend().prepare(INPUT)).rejects.toThrow(/AGENT_GATEWAY_URL/);
    expect(h.overVystup).toHaveBeenCalledWith(expect.objectContaining({ model: { promenna: 'ANTHROPIC_BASE_URL', url: 'https://model.example.test/v1' } }));
    expect(h.mockSpawn).not.toHaveBeenCalled();
    expect(h.mockDockerJSON).not.toHaveBeenCalled();
    expect(h.proxy.povolVystupBehu).not.toHaveBeenCalled();
  });

  it('síť běhů odmítnuta → výjimka před pracovním stromem; containers/create se nezavolá', async () => {
    h.proxy.zajistiCestuKBrokeru.mockRejectedValueOnce(new Error("síť běhů 'inst-exec-runs': NENÍ uzavřená"));
    await expect(new ClaudeCliBackend().prepare(INPUT)).rejects.toThrow(/NENÍ uzavřená/);
    expect(h.mockSpawn).not.toHaveBeenCalled();
    expect(h.mockDockerJSON).not.toHaveBeenCalled();
  });

  it('selhání startu kontejneru → kontejner smazán (token odregistruje finalize volajícího)', async () => {
    h.mockDockerStart.mockRejectedValueOnce(new Error('start => 404'));
    await expect(new ClaudeCliBackend().prepare(INPUT)).rejects.toThrow(/start/);
    expect(h.mockDockerRequest).toHaveBeenCalledWith('DELETE', '/v1.46/containers/cc1?force=true');
  });

  it('token, který neběží, výstup nedostane → výjimka, kontejner se nezaloží', async () => {
    h.proxy.povolVystupBehu.mockImplementationOnce(() => { throw new Error('broker-proxy: výstup pro běh, který neběží'); });
    await expect(new ClaudeCliBackend().prepare(INPUT)).rejects.toThrow(/neběží/);
    expect(h.mockDockerJSON.mock.calls.some((c) => String(c[1]).endsWith('/containers/create'))).toBe(false);
  });
});
