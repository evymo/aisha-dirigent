/**
 * Dveře na cestě požadavku — vlastnosti, ne zápis.
 *
 * Tři, na kterých to celé stojí:
 *   1. `measure` NIKDY nezavře (jinak to není měření, ale provoz).
 *   2. Na „nevím, kdo to je" se ZAVÍRÁ, nedosazuje se náhrada.
 *   3. Prohlížeč dostane forward, API klient jednoznačný 403 — telefon podle
 *      něj pozná „jsem zamčený" a teprve pak smí nabídnout zaťukání.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { parseTrusted } from '@aisha/knock-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DoorEvent,
  type DoorMode,
  hlavickySAdresou,
  jePozadavekProhlizece,
  registerDoorGuard,
  rozhodni,
  DOOR_HEADER,
  DOOR_HEADER_VALUE,
} from './door-guard.js';

const NASE_PROXY = parseTrusted(['10.0.0.0/8']);

/**
 * Mapa dveří v paměti.
 *
 * `verdict()` čte PIPELINE (`multi().get().ttl().exec()`), ne přímé `get` —
 * mock s holým `get` by prošel překladačem, vracel by „zavřeno" na všechno a
 * test „zaťukaná adresa projde" by tiše měřil něco jiného.
 */
function falesnyRedis(otevrene: Record<string, string>) {
  return {
    multi() {
      const prikazy: Array<[string, string]> = [];
      const pipe = {
        get(key: string) { prikazy.push(['get', key]); return pipe; },
        ttl(key: string) { prikazy.push(['ttl', key]); return pipe; },
        async exec() {
          return prikazy.map(([op, key]) =>
            op === 'get'
              ? [null, otevrene[key] ?? null]
              : [null, otevrene[key] !== undefined ? 60 : -2],
          );
        },
      };
      return pipe;
    },
  } as never;
}

async function postav(mode: DoorMode, otevrene: Record<string, string> = {}) {
  const udalosti: DoorEvent[] = [];
  const app: FastifyInstance = Fastify();
  registerDoorGuard(app, {
    forwardUrl: 'https://jinam.example',
    mode,
    onVerdict: (e) => udalosti.push(e),
    redis: falesnyRedis(otevrene),
    trustedProxies: NASE_PROXY,
    ttlSec: 120,
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/rest/v1/rpc/neco', async () => ({ data: 1 }));
  app.get('/prihlaseni', async () => 'stranka');
  await app.ready();
  return { app, udalosti };
}

const jakoTelefon = { 'x-forwarded-for': '198.51.100.7, 10.0.0.5', accept: 'application/json' };
const jakoProhlizec = { 'x-forwarded-for': '198.51.100.7, 10.0.0.5', accept: 'text/html,*/*' };

afterEach(() => vi.clearAllMocks());

describe('kdo se ptá — forward jen prohlížeči', () => {
  it('`*/*` NENÍ prohlížeč (posílá ho curl i každý API klient)', () => {
    expect(jePozadavekProhlizece('*/*')).toBe(false);
    expect(jePozadavekProhlizece('application/json')).toBe(false);
    expect(jePozadavekProhlizece(undefined)).toBe(false);
  });

  it('`text/html` musí být vyjmenované', () => {
    expect(jePozadavekProhlizece('text/html,application/xhtml+xml')).toBe(true);
  });
});

describe('rozhodni — měření nikdy nezavírá', () => {
  const zavreno = { allowed: false, via: 'closed' } as const;

  it('v `measure` je akce vždy `pass`, i když verdikt zní zavřeno', () => {
    const ev = rozhodni(zavreno, '198.51.100.7', 'measure', '/rest/v1/x', false);
    expect(ev.allowed).toBe(false); // verdikt se SPOČÍTÁ…
    expect(ev.action).toBe('pass'); // …ale nic se nezavře
  });

  it('neodvoditelná adresa je „zavřeno“, ne „propustit“', () => {
    const ev = rozhodni({ allowed: true, via: 'knock' }, null, 'enforce', '/x', false);
    expect(ev.allowed).toBe(false);
    expect(ev.verdict).toBe('no-client-ip');
    expect(ev.action).toBe('deny');
  });
});

describe('hook v provozu', () => {
  it('měřicí režim pustí i neznámou adresu — a zapíše, že by ji odmítl', async () => {
    const { app, udalosti } = await postav('measure');
    const r = await app.inject({ headers: jakoTelefon, method: 'GET', url: '/rest/v1/rpc/neco' });

    expect(r.statusCode).toBe(200);
    expect(udalosti[0]).toMatchObject({ action: 'pass', allowed: false, ip: '198.51.100.7' });
  });

  it('ostrý režim: telefon dostane 403 bez těla, ne forward', async () => {
    const { app } = await postav('enforce');
    const r = await app.inject({ headers: jakoTelefon, method: 'GET', url: '/rest/v1/rpc/neco' });

    expect(r.statusCode).toBe(403);
    expect(r.body).toBe('');
    // Kdyby tu byl forward, telefon by viděl odpověď cizí adresy a vyhodnotil
    // ji jako vadu SVÝCH dat — a po třech pokusech by zahodil práci řidiče.
    expect(r.headers.location).toBeUndefined();
  });

  /**
   * ⭐ ODMÍTNUTÍ MUSÍ ŘÍCT, ČÍ JE (2026-08-19). Zadání majitele: vyhodnocení
   * odpovědi edge musí být JEDNOZNAČNÉ — buď přesměruje pryč (problém
   * s dveřníkem), nebo řekne chybu (a víme, že jde o oprávnění).
   *
   * Holý 403 to nesplňoval: týmž statusem odpovídá i APLIKACE, když člověk na
   * úkon nemá nárok (RLS / errcode 42501 — osm míst v SoT). Telefon je
   * nerozlišil, takže dispečerské přehození dodávky jinému řidiči zaseklo
   * řidiči A celou offline frontu a nabídlo mu zaťukání, přestože jeho
   * identita byla v pořádku.
   *
   * Značka neprozrazuje PROČ — jen ČÍ. Nenápadnost tím netrpí: holý 403 už
   * dnes API klientovi prozrazuje totéž, a je to vědomá volba.
   */
  it('odmítnutí od dveřníka se OZNAČÍ — aplikace odpovídá týmž statusem', async () => {
    const { app } = await postav('enforce');
    const r = await app.inject({ headers: jakoTelefon, method: 'GET', url: '/rest/v1/rpc/neco' });

    expect(r.headers[DOOR_HEADER]).toBe(DOOR_HEADER_VALUE);
    // Značka říká ČÍ odmítnutí to je, ne PROČ — tělo zůstává prázdné.
    expect(r.body).toBe('');
  });

  it('prohlížeč značku nepotřebuje — jeho odpověď je jednoznačná už tím, že je 307', async () => {
    const { app } = await postav('enforce');
    const r = await app.inject({ headers: jakoProhlizec, method: 'GET', url: '/prihlaseni' });

    expect(r.statusCode).toBe(307);
    expect(r.headers.location).toBeDefined();
  });

  it('kdo projde, žádnou značku nedostane — jinak by se pass četl jako zamčeno', async () => {
    const { app } = await postav('enforce', { 'knock:ip:198.51.100.7': 'telefon-ridice' });
    const r = await app.inject({ headers: jakoTelefon, method: 'GET', url: '/rest/v1/rpc/neco' });

    expect(r.statusCode).toBe(200);
    expect(r.headers[DOOR_HEADER]).toBeUndefined();
  });

  it('ostrý režim: prohlížeč jde na adresu z administrace', async () => {
    const { app } = await postav('enforce');
    const r = await app.inject({ headers: jakoProhlizec, method: 'GET', url: '/prihlaseni' });

    expect(r.statusCode).toBe(307);
    expect(r.headers.location).toBe('https://jinam.example');
  });

  it('zaťukaná adresa projde', async () => {
    const { app } = await postav('enforce', { 'knock:ip:198.51.100.7': 'telefon-ridice' });
    const r = await app.inject({ headers: jakoTelefon, method: 'GET', url: '/rest/v1/rpc/neco' });

    expect(r.statusCode).toBe(200);
  });

  it('zdraví zůstává dostupné i zavřeno — jinak porucha dveří vypadá jako mrtvá služba', async () => {
    const { app, udalosti } = await postav('enforce');
    const r = await app.inject({ headers: jakoTelefon, method: 'GET', url: '/health' });

    expect(r.statusCode).toBe(200);
    expect(udalosti).toHaveLength(0); // dveře se na to ani neptaly
  });

  it('nedostupná mapa ZAVÍRÁ (fail-closed), na rozdíl od odvolávání tokenů', async () => {
    const udalosti: DoorEvent[] = [];
    const app = Fastify();
    registerDoorGuard(app, {
      forwardUrl: 'https://jinam.example',
      mode: 'enforce',
      onVerdict: (e) => udalosti.push(e),
      redis: null, // úložiště není
      trustedProxies: NASE_PROXY,
      ttlSec: 120,
    });
    app.get('/rest/v1/rpc/neco', async () => ({ data: 1 }));
    await app.ready();

    const r = await app.inject({ headers: jakoTelefon, method: 'GET', url: '/rest/v1/rpc/neco' });
    expect(r.statusCode).toBe(403);
  });

  it('`off` hook vůbec nezaregistruje — instance bez dveří nenese jejich riziko', async () => {
    const udalosti: DoorEvent[] = [];
    const app = Fastify();
    registerDoorGuard(app, {
      forwardUrl: 'https://jinam.example',
      mode: 'off',
      onVerdict: (e) => udalosti.push(e),
      redis: null,
      trustedProxies: NASE_PROXY,
      ttlSec: 120,
    });
    app.get('/rest/v1/rpc/neco', async () => ({ data: 1 }));
    await app.ready();

    const r = await app.inject({ headers: jakoTelefon, method: 'GET', url: '/rest/v1/rpc/neco' });
    expect(r.statusCode).toBe(200);
    expect(udalosti).toHaveLength(0);
  });
});

/**
 * BRÁNA: měřidlo dveří ukazuje svůj VSTUP, ne jen závěr.
 *
 * ⛔ 2026-08-31: `measure` hlásil `ip:null` a nic víc. Ze závěru bez vstupu se
 * nedalo přezkoumat, kterou hlavičkou adresa přichází — hádalo se to třikrát
 * po sobě. Vlastnost, kterou tahle brána drží, není „loguje se hlavička X",
 * ale „vstup je vidět, a jeho univerzum se HLEDÁ, nepíše".
 */
describe('brána: měřidlo dveří ukazuje svůj vstup', () => {
  it('v measure nese záznam vstup, v enforce ne', () => {
    const v = { allowed: false, via: 'closed' } as never;
    const m = rozhodni(v, null, 'measure', '/x', false, { 'x-forwarded-for': '1.2.3.4' });
    expect(m.vstup).toEqual({ 'x-forwarded-for': '1.2.3.4' });
    expect(rozhodni(v, '1.2.3.4', 'enforce', '/x', false).vstup).toBeUndefined();
  });

  it('najde adresu i v hlavičce, jejíž jméno neznáme', () => {
    // Tohle je ta vlastnost. Ruční výčet by spolkl přesně tu, kterou hledáme.
    const n = hlavickySAdresou({ 'x-jmeno-ktere-neznam': '198.51.100.143' });
    expect(n).toEqual({ 'x-jmeno-ktere-neznam': '198.51.100.143' });
  });

  it('nese CELOU hlavičku, nejen první prvek řetězu', () => {
    const n = hlavickySAdresou({ 'x-forwarded-for': '198.51.100.143, 192.168.2.1, 100.126.250.10' });
    expect(n['x-forwarded-for']).toContain('100.126.250.10');
  });

  it('tajemství se do měření nedostane', () => {
    const n = hlavickySAdresou({ cookie: 'sid=1.2.3.4', authorization: 'Bearer 1.2.3.4' });
    expect(n).toEqual({});
  });

  it('dlouhá hodnota se ustřihne — měřidlo nejde zahltit', () => {
    const dlouha = `1.2.3.4, ${'9.9.9.9, '.repeat(200)}`;
    const n = hlavickySAdresou({ 'x-forwarded-for': dlouha });
    expect(n['x-forwarded-for']!.length).toBeLessThanOrEqual(513);
  });

  it('hlavička bez adresy se nesbírá', () => {
    expect(hlavickySAdresou({ accept: 'text/html', 'user-agent': 'curl/8' })).toEqual({});
  });
});
