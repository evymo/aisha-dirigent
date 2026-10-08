import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { config } from '../config.js';
import {
  brokerUrlProBeh, cestaProSandbox, jeCestaPayloadu, mistniAdresa, odregistrujBeh, PAYLOAD_ENV_STROP, payloadDoEnv,
  povolVystupBehu, proxyUrlProBeh, registrujBeh, tokenZProxyAutorizace, vytvorBrokerProxy,
} from '../broker-proxy.js';
import type { EgressTarget } from '../egress-policy.js';

// Skutečný „broker“ (HTTP server) a skutečná proxy na portu — žádný mock transportu.
// Proxy rozhoduje i podle adresy, na kterou požadavek DORAZIL; měří se proto přes
// opravdový socket, ne přes inject.

// `config` je `as const`; test přepíná cíl brokeru a alias proxy výslovně zapisovatelným pohledem.
const cfg = config as unknown as { pluginBrokerUrl: string; brokerProxyAlias: string; brokerProxyPort: number };

type Prijato = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
let prijato: Prijato[] = [];
let broker: http.Server;
let proxy: ReturnType<typeof vytvorBrokerProxy>;
let proxyPort = 0;
let povolenaAdresa: string | null = '127.0.0.1';

// Cíl CONNECT: TCP echo na 127.0.0.1. „Jméno → IP“ rozhoduje dosazený resolver (výchozí
// ochranu SSRF měří egress-policy.unit.test.ts nad IP literály — bez sítě).
let echo: net.Server;
let echoPort = 0;
let echoSpojeni = 0;
const resolveVolani: EgressTarget[] = [];
let resolveOdmitne = false;

function pozadavek(cesta: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: cesta, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let b = '';
      res.on('data', (c: Buffer) => { b += c.toString('utf8'); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

beforeAll(async () => {
  broker = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c: Buffer) => { b += c.toString('utf8'); });
    req.on('end', () => {
      prijato.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: b });
      res.writeHead(req.url?.startsWith('/sandbox/chyba') ? 418 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  await new Promise<void>((r) => broker.listen(0, '127.0.0.1', () => r()));
  cfg.pluginBrokerUrl = `http://127.0.0.1:${(broker.address() as AddressInfo).port}`;

  echo = net.createServer((s) => {
    echoSpojeni += 1;
    s.on('data', (d) => s.write(Buffer.concat([Buffer.from('ECHO:'), d])));
    s.on('error', () => {});
  });
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
  echoPort = (echo.address() as AddressInfo).port;

  proxy = vytvorBrokerProxy(() => povolenaAdresa, {
    resolveTarget: async (cil) => {
      resolveVolani.push(cil);
      if (resolveOdmitne) throw new Error('Resolved IP blocked: 10.0.0.5');
      return '127.0.0.1';
    },
  });
  await proxy.listen({ port: 0, host: '127.0.0.1' });
  proxyPort = (proxy.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await proxy.close();
  await new Promise<void>((r) => broker.close(() => r()));
  await new Promise<void>((r) => echo.close(() => r()));
});

beforeEach(() => {
  prijato = [];
  povolenaAdresa = '127.0.0.1';
  echoSpojeni = 0;
  resolveVolani.length = 0;
  resolveOdmitne = false;
});

describe('cestaProSandbox — rozhoduje normalizovaná cesta', () => {
  it('pustí /sandbox/* i s query', () => {
    expect(cestaProSandbox('/sandbox/config')).toBe('/sandbox/config');
    expect(cestaProSandbox('/sandbox/fetch?x=1')).toBe('/sandbox/fetch?x=1');
  });
  it('⛔ nepustí nic mimo /sandbox/ ani únik přes ..', () => {
    expect(cestaProSandbox('/runs')).toBeNull();
    expect(cestaProSandbox('/health')).toBeNull();
    expect(cestaProSandbox('/sandbox')).toBeNull();
    expect(cestaProSandbox('/sandbox/../runs')).toBeNull();
    expect(cestaProSandbox('/sandbox/%2e%2e/runs')).toBeNull();
    expect(cestaProSandbox('/sandbox/a%2F..%2F..%2Fruns')).toBeNull();
    expect(cestaProSandbox('/sandbox/%E0%A4%A')).toBeNull(); // nedekódovatelné
  });
});

describe('broker-proxy — jen token běžícího běhu, jen /sandbox/*', () => {
  it('předá požadavek běžícího běhu a vrátí odpověď brokeru beze změny', async () => {
    registrujBeh('tok-1');
    try {
      const r = await pozadavek('/sandbox/fetch?x=1', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json', cookie: 'tajne=1', 'x-forwarded-for': '6.6.6.6' },
        body: '{"url":"https://api.example.com"}',
      });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ ok: true, url: '/sandbox/fetch?x=1' });
      expect(prijato).toHaveLength(1);
      expect(prijato[0]!.method).toBe('POST');
      expect(prijato[0]!.body).toBe('{"url":"https://api.example.com"}');
      expect(prijato[0]!.headers.authorization).toBe('Bearer tok-1');
      expect(prijato[0]!.headers['content-type']).toBe('application/json');
      // ⛔ cizí hlavičky ze sandboxu k brokeru nejdou
      expect(prijato[0]!.headers.cookie).toBeUndefined();
      expect(prijato[0]!.headers['x-forwarded-for']).toBeUndefined();
    } finally {
      odregistrujBeh('tok-1');
    }
  });

  it('stav odpovědi brokeru projde (418 zůstane 418)', async () => {
    registrujBeh('tok-2');
    try {
      const r = await pozadavek('/sandbox/chyba', { headers: { authorization: 'Bearer tok-2' } });
      expect(r.status).toBe(418);
    } finally {
      odregistrujBeh('tok-2');
    }
  });

  it('⛔ neznámý token → 401 a broker se NEVOLÁ', async () => {
    const r = await pozadavek('/sandbox/config', { headers: { authorization: 'Bearer cizi' } });
    expect(r.status).toBe(401);
    expect(prijato).toHaveLength(0);
  });

  it('⛔ bez tokenu → 401', async () => {
    const r = await pozadavek('/sandbox/config');
    expect(r.status).toBe(401);
    expect(prijato).toHaveLength(0);
  });

  it('⛔ po skončení běhu token neplatí', async () => {
    registrujBeh('tok-3');
    odregistrujBeh('tok-3');
    const r = await pozadavek('/sandbox/config', { headers: { authorization: 'Bearer tok-3' } });
    expect(r.status).toBe(401);
    expect(prijato).toHaveLength(0);
  });

  it('⛔ mimo /sandbox/ → 404 i s platným tokenem; broker se nevolá', async () => {
    registrujBeh('tok-4');
    try {
      for (const cesta of ['/runs', '/health', '/sandbox/../runs', '/sandbox/%2e%2e/runs']) {
        const r = await pozadavek(cesta, { headers: { authorization: 'Bearer tok-4' } });
        expect(r.status, cesta).toBe(404);
      }
      expect(prijato).toHaveLength(0);
    } finally {
      odregistrujBeh('tok-4');
    }
  });

  it('⛔ požadavek, který nedorazil na adresu v exec síti → 404', async () => {
    registrujBeh('tok-5');
    try {
      povolenaAdresa = '10.255.255.1';
      const r = await pozadavek('/sandbox/config', { headers: { authorization: 'Bearer tok-5' } });
      expect(r.status).toBe(404);
      povolenaAdresa = null; // adresa ještě nezjištěna → odmítá vše
      const r2 = await pozadavek('/sandbox/config', { headers: { authorization: 'Bearer tok-5' } });
      expect(r2.status).toBe(404);
      expect(prijato).toHaveLength(0);
    } finally {
      odregistrujBeh('tok-5');
    }
  });

  it('nedosažitelný broker → 502 s důvodem, ne visení', async () => {
    const puvodni = config.pluginBrokerUrl;
    cfg.pluginBrokerUrl = 'http://127.0.0.1:1';
    registrujBeh('tok-6');
    try {
      const r = await pozadavek('/sandbox/config', { headers: { authorization: 'Bearer tok-6' } });
      expect(r.status).toBe(502);
      expect(JSON.parse(r.body).error).toBe('broker_unreachable');
    } finally {
      odregistrujBeh('tok-6');
      cfg.pluginBrokerUrl = puvodni;
    }
  });
});

describe('adresa pro běh a místní adresa', () => {
  it('běh volá VŽDY proxy — nikdy broker přímo (proxy je povinná, 2026-10-06 volba A)', () => {
    const puvodni = config.brokerProxyAlias;
    try {
      cfg.brokerProxyAlias = 'inst-plugin-broker';
      expect(brokerUrlProBeh()).toBe(`http://inst-plugin-broker:${config.brokerProxyPort}`);
      expect(brokerUrlProBeh()).not.toBe(config.pluginBrokerUrl);
      expect(proxyUrlProBeh('a.b-c_d')).toBe(`http://run:a.b-c_d@inst-plugin-broker:${config.brokerProxyPort}`);
    } finally {
      cfg.brokerProxyAlias = puvodni;
    }
  });
  it('IPv4 v IPv6 zápisu se srovná', () => {
    expect(mistniAdresa('::ffff:10.100.36.5')).toBe('10.100.36.5');
    expect(mistniAdresa('10.100.36.5')).toBe('10.100.36.5');
    expect(mistniAdresa(undefined)).toBe('');
  });
});

describe('payload běhu mimo ENV — strop jádra 128 KiB na řetězec env', () => {
  it('malý payload jde do ENV jako dosud', () => {
    const r = payloadDoEnv('{"plugin_code":"x"}');
    expect(r).toEqual({ env: ['PLUGIN_PAYLOAD={"plugin_code":"x"}'], mimoEnv: undefined });
  });

  it('⛔ velký payload (kód pluginu 155 KB) do ENV NEJDE — drží ho runner', () => {
    const puvodni = cfg.brokerProxyAlias;
    cfg.brokerProxyAlias = 'inst-plugin-broker';
    try {
      const velky = JSON.stringify({ plugin_code: 'x'.repeat(155_000) });
      const r = payloadDoEnv(velky);
      expect(r.env).toEqual([]);
      expect(r.mimoEnv).toBe(velky);
      // hranice: přesně strop ještě do ENV, o bajt víc už ne
      expect(payloadDoEnv('x'.repeat(PAYLOAD_ENV_STROP)).env).toHaveLength(1);
      expect(payloadDoEnv('x'.repeat(PAYLOAD_ENV_STROP + 1)).env).toEqual([]);
    } finally {
      cfg.brokerProxyAlias = puvodni;
    }
  });

  it('cesta payloadu je PŘESNĚ /beh/payload', () => {
    expect(jeCestaPayloadu('/beh/payload')).toBe(true);
    expect(jeCestaPayloadu('/beh/payload?x=1')).toBe(false);
    expect(jeCestaPayloadu('/beh/payload/')).toBe(false);
    expect(jeCestaPayloadu('/beh/../beh/payload')).toBe(true); // normalizuje se na tutéž cestu
    expect(jeCestaPayloadu('/sandbox/beh/payload')).toBe(false);
  });

  it('GET /beh/payload vydá payload JEN vlastnímu běhu; broker se nevolá', async () => {
    registrujBeh('tok-p1', '{"plugin_code":"velky"}');
    registrujBeh('tok-p2'); // payload jel v ENV
    try {
      const r = await pozadavek('/beh/payload', { headers: { authorization: 'Bearer tok-p1' } });
      expect(r.status).toBe(200);
      expect(r.body).toBe('{"plugin_code":"velky"}');
      const r2 = await pozadavek('/beh/payload', { headers: { authorization: 'Bearer tok-p2' } });
      expect(r2.status).toBe(404);
      const r3 = await pozadavek('/beh/payload', { headers: { authorization: 'Bearer cizi' } });
      expect(r3.status).toBe(401);
      const r4 = await pozadavek('/beh/payload', { method: 'POST', headers: { authorization: 'Bearer tok-p1' }, body: 'x' });
      expect(r4.status).toBe(404);
      expect(prijato).toHaveLength(0);
    } finally {
      odregistrujBeh('tok-p1');
      odregistrujBeh('tok-p2');
    }
    const po = await pozadavek('/beh/payload', { headers: { authorization: 'Bearer tok-p1' } });
    expect(po.status).toBe(401);
  });

  it('⛔ /beh/payload mimo exec síť → 404 i se správným tokenem', async () => {
    registrujBeh('tok-p3', '{"plugin_code":"velky"}');
    try {
      povolenaAdresa = '10.255.255.1';
      const r = await pozadavek('/beh/payload', { headers: { authorization: 'Bearer tok-p3' } });
      expect(r.status).toBe(404);
    } finally {
      odregistrujBeh('tok-p3');
    }
  });
});

// ── Výstup claude_cli_task: CONNECT jen s tokenem běhu a jen na povolené cíle ──────────
// (2026-10-06, majitel „síť zavřít“ = volba A; rada cb T10-A, M14-A). Každý zákaz má kotvu:
// povolený cíl ve stejném testu projde.

/** CONNECT přes proxy; při 200 pošle `zprava` tunelem a vrátí odpověď cíle. */
function connect(cil: string, proxyAuth?: string, zprava = 'ahoj'): Promise<{ status: number; tunel?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: cil,
      headers: proxyAuth ? { 'proxy-authorization': proxyAuth } : {},
    });
    req.on('connect', (res, sock) => {
      if (res.statusCode !== 200) {
        sock.destroy();
        return resolve({ status: res.statusCode ?? 0 });
      }
      sock.once('data', (d) => {
        sock.destroy();
        resolve({ status: 200, tunel: d.toString('utf8') });
      });
      sock.write(zprava);
    });
    req.on('response', (res) => resolve({ status: res.statusCode ?? 0 }));
    req.on('error', reject);
    req.end();
  });
}

const basic = (heslo: string, uzivatel = 'run') => 'Basic ' + Buffer.from(`${uzivatel}:${heslo}`).toString('base64');

describe('CONNECT — výstup běhu (claude_cli_task)', () => {
  it('bez tokenu / s cizím / se skončeným → 407, cíl nedostal spojení (kotva: běžící token s výčtem projde)', async () => {
    registrujBeh('tok-c1');
    povolVystupBehu('tok-c1', [{ host: 'povoleny.test', port: echoPort }]);
    try {
      expect((await connect(`povoleny.test:${echoPort}`)).status).toBe(407);
      expect((await connect(`povoleny.test:${echoPort}`, basic('cizi'))).status).toBe(407);
      expect(echoSpojeni).toBe(0);
      expect(await connect(`povoleny.test:${echoPort}`, basic('tok-c1'), 'tunel')).toEqual({ status: 200, tunel: 'ECHO:tunel' });
      expect(echoSpojeni).toBe(1);
    } finally {
      odregistrujBeh('tok-c1');
    }
    expect((await connect(`povoleny.test:${echoPort}`, basic('tok-c1'))).status).toBe(407);
  });

  it('⛔ běh pluginu (token bez výčtu) → 403: smí jen na broker', async () => {
    registrujBeh('tok-plugin');
    try {
      expect((await connect(`povoleny.test:${echoPort}`, basic('tok-plugin'))).status).toBe(403);
      expect(resolveVolani).toHaveLength(0);
      expect(echoSpojeni).toBe(0);
    } finally {
      odregistrujBeh('tok-plugin');
    }
  });

  it('M14-A: cíl mimo výčet, jiný port povoleného, IP literál, metadata → 403; resolver ani cíl se nevolají', async () => {
    registrujBeh('tok-c2');
    povolVystupBehu('tok-c2', [{ host: 'povoleny.test', port: echoPort }]);
    try {
      for (const cil of [`jiny.test:${echoPort}`, `povoleny.test:${echoPort + 1}`, `127.0.0.1:${echoPort}`, '169.254.169.254:80']) {
        expect((await connect(cil, basic('tok-c2'))).status, cil).toBe(403);
      }
      expect(resolveVolani).toHaveLength(0);
      expect(echoSpojeni).toBe(0);
      expect((await connect(`povoleny.test:${echoPort}`, basic('tok-c2'))).status).toBe(200); // kotva
    } finally {
      odregistrujBeh('tok-c2');
    }
  });

  it('povolené jméno, které ochrana SSRF odmítne (soukromá / mesh adresa) → 403, cíl nedostal spojení', async () => {
    registrujBeh('tok-c3');
    povolVystupBehu('tok-c3', [{ host: 'povoleny.test', port: echoPort }]);
    try {
      resolveOdmitne = true;
      expect((await connect(`povoleny.test:${echoPort}`, basic('tok-c3'))).status).toBe(403);
      expect(resolveVolani).toEqual([{ host: 'povoleny.test', port: echoPort }]);
      expect(echoSpojeni).toBe(0);
    } finally {
      odregistrujBeh('tok-c3');
    }
  });

  it('⛔ CONNECT, který nedorazil na adresu v exec síti → 404 i s platným tokenem', async () => {
    registrujBeh('tok-c4');
    povolVystupBehu('tok-c4', [{ host: 'povoleny.test', port: echoPort }]);
    try {
      povolenaAdresa = '10.255.255.1';
      expect((await connect(`povoleny.test:${echoPort}`, basic('tok-c4'))).status).toBe(404);
      povolenaAdresa = null;
      expect((await connect(`povoleny.test:${echoPort}`, basic('tok-c4'))).status).toBe(404);
      expect(echoSpojeni).toBe(0);
    } finally {
      odregistrujBeh('tok-c4');
    }
  });

  it('nečitelný cíl CONNECT → 400', async () => {
    registrujBeh('tok-c5');
    povolVystupBehu('tok-c5', [{ host: 'povoleny.test', port: echoPort }]);
    try {
      expect((await connect('povoleny.test', basic('tok-c5'))).status).toBe(400);
    } finally {
      odregistrujBeh('tok-c5');
    }
  });

  it('povolVystupBehu: neregistrovaný token nebo prázdný výčet = výjimka', () => {
    expect(() => povolVystupBehu('neexistuje', [{ host: 'a.test', port: 443 }])).toThrow(/neběží/);
    registrujBeh('tok-c6');
    try {
      expect(() => povolVystupBehu('tok-c6', [])).toThrow(/prázdný výčet/);
    } finally {
      odregistrujBeh('tok-c6');
    }
  });

  it('tokenZProxyAutorizace: token z hesla Basic, jinak prázdno', () => {
    expect(tokenZProxyAutorizace(basic('a.b.c'))).toBe('a.b.c');
    expect(tokenZProxyAutorizace(basic('a%2Eb'))).toBe('a.b');
    expect(tokenZProxyAutorizace('Bearer x')).toBe('');
    expect(tokenZProxyAutorizace(undefined)).toBe('');
    expect(tokenZProxyAutorizace('Basic ' + Buffer.from('bezdvojtecky').toString('base64'))).toBe('');
  });
});
