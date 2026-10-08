import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Falešný Docker Engine na unixovém socketu: drží stav sítí (i jejich `Internal`) a sítí
// kontejneru runneru a zapisuje každé volání. Měří se, CO runner Dockeru pošle, ne jen
// návratová hodnota.
const sock = vi.hoisted(() => ({ path: '' }));
vi.mock('../config.js', () => ({
  config: {
    get dockerSocket() { return sock.path; },
    dockerApiVersion: 'v1.45',
    dockerExecNetwork: 'inst-exec-runs',
  },
}));

import { adresyRunneruMimoExecSit, ensureExecNetwork, pripojKExecSiti } from '../backends/docker-http.js';

type Ep = { IPAddress: string; Aliases: string[] };
type Sit = { Name: string; Internal?: unknown; Options?: Record<string, string>; IPAM?: unknown };
const BEZ_ADRESY = 'com.docker.network.bridge.inhibit_ipv4';
/** Síť tak, jak ji Docker 29 vrací: s inhibit_ipv4 bez brány v IPAM, bez ní s bránou. */
const sitDockeru = (Internal: unknown, inhibit: boolean): Sit => ({
  Name: 'inst-exec-runs',
  Internal,
  Options: inhibit ? { [BEZ_ADRESY]: 'true' } : {},
  IPAM: { Config: [inhibit ? { Subnet: '172.25.0.0/16' } : { Subnet: '172.25.0.0/16', Gateway: '172.25.0.1' }] },
});
let site: Record<string, Ep> = {};
let siteDockeru: Record<string, Sit> = {};
let volani: Array<{ method: string; url: string; body: unknown }> = [];
let connectStatus = 200;
/** Přepis odpovědi na GET sítě (nečitelná / chybová odpověď Dockeru). */
let inspekceSite: { status: number; body: string } | null = null;
/** Docker při založení „zapomene“ Internal (měří se, co SKUTEČNĚ založil). */
let createIgnorujeInternal = false;
/** Starší Docker volbu inhibit_ipv4 nezná — bridge dostane bránu. */
let createIgnorujeInhibit = false;
let dir = '';
let server: http.Server;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'exec-sit-'));
  sock.path = join(dir, 'docker.sock');
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      volani.push({ method: req.method ?? '', url: req.url ?? '', body });
      const json = (status: number, v: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (req.method === 'GET' && req.url === '/v1.45/networks/inst-exec-runs') {
        if (inspekceSite) { res.writeHead(inspekceSite.status); return res.end(inspekceSite.body); }
        const sit = siteDockeru['inst-exec-runs'];
        return sit ? json(200, sit) : json(404, { message: 'network inst-exec-runs not found' });
      }
      if (req.method === 'POST' && req.url === '/v1.45/networks/create') {
        const inhibit = !createIgnorujeInhibit && body.Options?.[BEZ_ADRESY] === 'true';
        siteDockeru[body.Name] = { ...sitDockeru(createIgnorujeInternal ? false : body.Internal, inhibit), Name: body.Name };
        return json(201, { Id: 'n1' });
      }
      if (req.url === '/v1.45/containers/runner123/json') return json(200, { NetworkSettings: { Networks: site } });
      if (req.url === '/v1.45/networks/inst-exec-runs/connect') {
        if (connectStatus !== 200) return json(connectStatus, { message: 'nejde' });
        site['inst-exec-runs'] = { IPAddress: '10.100.36.2', Aliases: [...(body?.EndpointConfig?.Aliases ?? [])] };
        res.writeHead(200); return res.end();
      }
      if (req.url === '/v1.45/networks/inst-exec-runs/disconnect') {
        delete site['inst-exec-runs'];
        res.writeHead(200); return res.end();
      }
      json(404, { message: 'nic' });
    });
  });
  await new Promise<void>((r) => server.listen(sock.path, () => r()));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  site = {};
  siteDockeru = { 'inst-exec-runs': sitDockeru(true, true) };
  volani = [];
  connectStatus = 200;
  inspekceSite = null;
  createIgnorujeInternal = false;
  createIgnorujeInhibit = false;
  vi.stubEnv('HOSTNAME', 'runner123');
});

const zalozeni = () => volani.filter((v) => v.url.endsWith('/networks/create'));

describe('síť běhů je UZAVŘENÁ (2026-10-06, volba A; rada cb T2–T5, T9)', () => {
  it('T2: síť neexistuje → založí ji s Internal: true a bez adresy hostitele (a změří, co Docker založil)', async () => {
    siteDockeru = {};
    await ensureExecNetwork();
    expect(zalozeni()).toHaveLength(1);
    expect(zalozeni()[0]!.body).toEqual({
      Name: 'inst-exec-runs', Driver: 'bridge', Internal: true, EnableIPv6: false, Options: { [BEZ_ADRESY]: 'true' },
    });
    expect(volani.filter((v) => v.method === 'GET')).toHaveLength(2); // před a PO založení
  });

  it('T3: síť existuje a je uzavřená → použije se, nic se nezakládá', async () => {
    await ensureExecNetwork();
    expect(zalozeni()).toHaveLength(0);
  });

  it('T4: síť existuje a uzavřená NENÍ → chyba se jménem sítě, nic se nezakládá (kotva: uzavřená projde)', async () => {
    siteDockeru['inst-exec-runs'] = sitDockeru(false, true);
    await expect(ensureExecNetwork()).rejects.toThrow(/inst-exec-runs.*NENÍ uzavřená/);
    expect(zalozeni()).toHaveLength(0);
    siteDockeru['inst-exec-runs'] = sitDockeru(true, true);
    await expect(ensureExecNetwork()).resolves.toBeUndefined();
  });

  it('T4: `Internal` chybí nebo není boolean true → chyba (žádné „asi uzavřená“)', async () => {
    for (const Internal of [undefined, 'true', 1, null]) {
      siteDockeru['inst-exec-runs'] = sitDockeru(Internal, true);
      await expect(ensureExecNetwork()).rejects.toThrow(/NENÍ uzavřená/);
    }
  });

  it('T5: chyba Dockeru / nečitelný JSON / jiný tvar / jiné jméno → chyba', async () => {
    inspekceSite = { status: 500, body: '{"message":"boom"}' };
    await expect(ensureExecNetwork()).rejects.toThrow(/500/);
    inspekceSite = { status: 200, body: '1270\r\n[{"Name"' };
    await expect(ensureExecNetwork()).rejects.toThrow(/JSON/);
    inspekceSite = { status: 200, body: '[]' };
    await expect(ensureExecNetwork()).rejects.toThrow(/tvar/);
    inspekceSite = { status: 200, body: '{"Name":"inst-exec-runs-cizi","Internal":true}' };
    await expect(ensureExecNetwork()).rejects.toThrow(/jinou síť/);
    expect(zalozeni()).toHaveLength(0);
  });

  it('T5: výpis sítě selže (socket Dockeru nedostupný) → chyba, nic se nezakládá', async () => {
    const puvodni = sock.path;
    sock.path = join(dir, 'neexistuje.sock');
    try {
      await expect(ensureExecNetwork()).rejects.toThrow(/nejde změřit/);
    } finally {
      sock.path = puvodni;
    }
    expect(zalozeni()).toHaveLength(0);
  });

  it('Docker při založení Internal nedodrží → chyba (měří se výsledek, ne požadavek)', async () => {
    siteDockeru = {};
    createIgnorujeInternal = true;
    await expect(ensureExecNetwork()).rejects.toThrow(/NENÍ uzavřená/);
  });

  it('⛔ uzavřená síť, kde má hostitel adresu (brána v IPAM / bez inhibit_ipv4) → chyba (kotva: bez adresy projde)', async () => {
    siteDockeru['inst-exec-runs'] = sitDockeru(true, false);
    await expect(ensureExecNetwork()).rejects.toThrow(/hostitel v ní má adresu.*172\.25\.0\.1/);
    siteDockeru['inst-exec-runs'] = { ...sitDockeru(true, true), Options: {} };
    await expect(ensureExecNetwork()).rejects.toThrow(/inhibit_ipv4=undefined/);
    siteDockeru['inst-exec-runs'] = { ...sitDockeru(true, true), IPAM: { Config: [{ Subnet: '172.25.0.0/16', Gateway: '172.25.0.1' }] } };
    await expect(ensureExecNetwork()).rejects.toThrow(/hostitel v ní má adresu/);
    expect(zalozeni()).toHaveLength(0);
    siteDockeru['inst-exec-runs'] = sitDockeru(true, true);
    await expect(ensureExecNetwork()).resolves.toBeUndefined();
  });

  it('starší Docker volbu inhibit_ipv4 nezná (bridge dostane bránu) → chyba po založení, ne tiché použití', async () => {
    siteDockeru = {};
    createIgnorujeInhibit = true;
    await expect(ensureExecNetwork()).rejects.toThrow(/hostitel v ní má adresu/);
  });

  it('T9: druhé měření poté, co síť někdo nahradil otevřenou → zase chyba (žádná paměť „ověřeno“)', async () => {
    await ensureExecNetwork();
    siteDockeru['inst-exec-runs'] = sitDockeru(false, true);
    await expect(ensureExecNetwork()).rejects.toThrow(/NENÍ uzavřená/);
  });
});

describe('runner se SÁM připojí k exec síti pod aliasem broker-proxy', () => {
  it('nepřipojený → připojí s aliasem a exec síť nikdy nedostane výchozí trasu', async () => {
    const ip = await pripojKExecSiti('inst-plugin-broker');
    expect(ip).toBe('10.100.36.2');
    const connect = volani.find((v) => v.url.endsWith('/connect'));
    expect(connect?.body).toEqual({ Container: 'runner123', EndpointConfig: { Aliases: ['inst-plugin-broker'], GwPriority: -1 } });
  });

  it('⛔ do OTEVŘENÉ sítě se runner nepřipojí — chyba dřív, než se zavolá connect', async () => {
    siteDockeru['inst-exec-runs'] = sitDockeru(false, true);
    await expect(pripojKExecSiti('inst-plugin-broker')).rejects.toThrow(/NENÍ uzavřená/);
    expect(volani.some((v) => v.url.endsWith('/connect'))).toBe(false);
  });

  it('už připojený s aliasem → nic nemění, jen vrátí adresu', async () => {
    site['inst-exec-runs'] = { IPAddress: '10.100.36.9', Aliases: ['runner123', 'inst-plugin-broker'] };
    expect(await pripojKExecSiti('inst-plugin-broker')).toBe('10.100.36.9');
    expect(volani.some((v) => v.url.endsWith('/connect') || v.url.endsWith('/disconnect'))).toBe(false);
  });

  it('⛔ připojený BEZ aliasu → odpojí a připojí znovu (sandbox by jméno nepřeložil)', async () => {
    site['inst-exec-runs'] = { IPAddress: '10.100.36.9', Aliases: ['runner123'] };
    expect(await pripojKExecSiti('inst-plugin-broker')).toBe('10.100.36.2');
    const poradi = volani.filter((v) => v.url.endsWith('/connect') || v.url.endsWith('/disconnect')).map((v) => v.url.split('/').pop());
    expect(poradi).toEqual(['disconnect', 'connect']);
  });

  it('⛔ selhané připojení je chyba i se zprávou Dockeru', async () => {
    connectStatus = 500;
    await expect(pripojKExecSiti('inst-plugin-broker')).rejects.toThrow(/connect => 500: .*nejde/);
  });

  it('⛔ bez HOSTNAME runner nezná vlastní kontejner — chyba, ne hádání', async () => {
    vi.stubEnv('HOSTNAME', '');
    await expect(pripojKExecSiti('inst-plugin-broker')).rejects.toThrow(/HOSTNAME/);
  });
});

describe('adresy runneru MIMO síť běhů (kde smí API runneru)', () => {
  it('vrátí adresy ostatních sítí, adresu sítě běhů ne', async () => {
    site = {
      'inst-shared-net': { IPAddress: '10.0.1.5', Aliases: [] },
      coolify: { IPAddress: '10.0.2.7', Aliases: [] },
      'inst-exec-runs': { IPAddress: '172.27.0.1', Aliases: ['inst-plugin-broker'] },
      bezadresy: { IPAddress: '', Aliases: [] },
    };
    expect((await adresyRunneruMimoExecSit()).sort()).toEqual(['10.0.1.5', '10.0.2.7']);
  });

  it('⛔ bez HOSTNAME chyba, ne prázdný výčet', async () => {
    vi.stubEnv('HOSTNAME', '');
    await expect(adresyRunneruMimoExecSit()).rejects.toThrow(/HOSTNAME/);
  });
});
