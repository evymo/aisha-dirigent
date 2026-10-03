/**
 * Roster z adresy — testy.
 *
 * Těžiště není na „stáhne se to", ale na tom, co se stane, když je odpověď
 * podezřelá. Roster rozhoduje, KDO smí zaťukat: špatně přijatá odpověď buď
 * odstřihne lidi, kteří dovnitř patří, nebo pustí ty, kteří ne. Obojí vypadá
 * zvenčí jako klid.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Operator } from '@aisha/knock-protocol';
import { freshDeviceSecrets } from '@aisha/knock-protocol/node';
import { posudRoster, spojSeZakladem, spustObnovuRosteru, stahniVerzi, type RosterZdroj } from '../roster.js';

function operator(over: Partial<Operator> = {}): Operator {
  return { ...freshDeviceSecrets(), scopes: ['suite'], kind: 'device', ...over } as Operator;
}

const ZDROJ: RosterZdroj = {
  url: 'https://api.example/manage/knock-roster',
  versionUrl: 'https://api.example/manage/knock-roster/version',
  token: 'tajne',
  intervalSec: 30,
};

/** Odpovídá podle mapy adresa → tělo. Neznámá adresa = 500. */
function fakeFetch(mapa: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request) => {
    const z = mapa[String(url)];
    if (z === undefined) return new Response('nic', { status: 500 });
    return new Response(JSON.stringify(z), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const volani = (f: typeof fetch): unknown[][] => (f as unknown as ReturnType<typeof vi.fn>).mock.calls;

describe('posudRoster', () => {
  it('přijme zdravý roster', () => {
    expect(posudRoster({ 'ev-11-a': operator() }, 1).ok).toBe(true);
  });

  it('ODMÍTNE CELÝ roster, když je jedna položka vadná', () => {
    // Vyhodit vadný záznam a zbytek přijmout znamená tiše odstřihnout jednoho
    // člověka. Odmítnutí celku nechá platit ten předchozí, o kterém víme, že jel.
    expect(posudRoster({ 'ev-11-a': operator(), 'ev-12-b': { scopes: [] } }, 2).ok).toBe(false);
  });

  it('odmítne roster, jehož počet nesedí s verzí', () => {
    // Prázdná mapa přijde i tehdy, když nám chybí oprávnění — pro nás je to
    // k nerozeznání od „všem odvolali pověření". Rozliší to až počet z verze.
    const v = posudRoster({}, 3);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.duvod).toMatch(/oprávnění|3/);
  });

  it('přijme prázdný roster, když verze taky hlásí nulu', () => {
    expect(posudRoster({}, 0).ok).toBe(true);
  });

  it('odmítne pole i null', () => {
    expect(posudRoster([], null).ok).toBe(false);
    expect(posudRoster(null, null).ok).toBe(false);
  });
});

describe('stahniVerzi', () => {
  it('bere state:false jako „nemáš právo", ne jako nula zařízení', async () => {
    const f = fakeFetch({ [ZDROJ.versionUrl]: { state: false } });
    expect(await stahniVerzi(ZDROJ, f)).toBeNull();
  });

  it('přečte otisk a počet', async () => {
    const f = fakeFetch({ [ZDROJ.versionUrl]: { state: true, version: 'abc', count: 2 } });
    expect(await stahniVerzi(ZDROJ, f)).toEqual({ version: 'abc', count: 2 });
  });

  it('posílá token v hlavičce X-Token', async () => {
    const f = fakeFetch({ [ZDROJ.versionUrl]: { state: true, version: 'v', count: 0 } });
    await stahniVerzi(ZDROJ, f);
    expect((volani(f)[0][1] as RequestInit).headers).toMatchObject({ 'X-Token': 'tajne' });
  });
});

describe('obnovovací smyčka', () => {
  it('nastaví roster a podruhé už netahá, když se verze nezměnila', async () => {
    const f = fakeFetch({
      [ZDROJ.versionUrl]: { state: true, version: 'v1', count: 1 },
      [ZDROJ.url]: { 'ev-11-a': operator() },
    });
    const nastav = vi.fn();
    const o = spustObnovuRosteru(ZDROJ, { nastav, log: () => {}, fetchImpl: f });

    await o.kolo();
    expect(nastav).toHaveBeenCalledTimes(1);
    expect(o.pripraven()).toBe(true);

    const poPrvnim = volani(f).length;
    await o.kolo();
    expect(nastav).toHaveBeenCalledTimes(1);
    // druhé kolo se zeptalo JEN na verzi
    expect(volani(f).length).toBe(poPrvnim + 1);
    o.stop();
  });

  it('při pádu stahování PONECHÁ předchozí roster', async () => {
    // Výpadek protistrany nesmí zavřít dveře lidem, kteří jsou uvnitř.
    const ops = { 'ev-11-a': operator() };
    let verze = 'v1';
    let rozbito = false;
    const f = vi.fn(async (url: string | URL | Request) => {
      if (rozbito) return new Response('mimo provoz', { status: 503 });
      if (String(url) === ZDROJ.versionUrl) {
        return new Response(JSON.stringify({ state: true, version: verze, count: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify(ops), { status: 200 });
    }) as unknown as typeof fetch;

    const nastav = vi.fn();
    const o = spustObnovuRosteru(ZDROJ, { nastav, log: () => {}, fetchImpl: f });
    await o.kolo();
    expect(nastav).toHaveBeenCalledTimes(1);

    rozbito = true;
    verze = 'v2';
    await o.kolo();
    expect(nastav).toHaveBeenCalledTimes(1); // nic se nepřepsalo
    expect(o.pripraven()).toBe(true); // pořád máme ten předchozí
    o.stop();
  });

  it('odmítnutý roster se NENASTAVÍ a ohlásí se důvod', async () => {
    const f = fakeFetch({
      [ZDROJ.versionUrl]: { state: true, version: 'v1', count: 5 },
      [ZDROJ.url]: {}, // počet nesedí — oříznutý pohled
    });
    const nastav = vi.fn();
    const zaznamy: Record<string, unknown>[] = [];
    const o = spustObnovuRosteru(ZDROJ, { nastav, log: (u) => zaznamy.push(u), fetchImpl: f });

    await o.kolo();
    expect(nastav).not.toHaveBeenCalled();
    expect(o.pripraven()).toBe(false);
    expect(zaznamy.some((z) => z.ev === 'roster-odmitnut')).toBe(true);
    o.stop();
  });

  it('bez verzní routy stahuje roster pokaždé', async () => {
    const bezVerze: RosterZdroj = { ...ZDROJ, versionUrl: '' };
    const f = fakeFetch({ [ZDROJ.url]: { 'ev-11-a': operator() } });
    const nastav = vi.fn();
    const o = spustObnovuRosteru(bezVerze, { nastav, log: () => {}, fetchImpl: f });

    await o.kolo();
    await o.kolo();
    expect(nastav).toHaveBeenCalledTimes(2);
    o.stop();
  });
});

describe('spojení se základem z prostředí', () => {
  it('základ zůstane, zařízení z adresy přibudou', () => {
    const technik = operator({ kind: 'person' });
    const tablet = operator();
    const s = spojSeZakladem({ 'ops-riq': technik }, { 'dev-0123456789abcdef': tablet }, {});
    expect(s.ok).toBe(true);
    if (s.ok) expect(Object.keys(s.operators).sort()).toEqual(['dev-0123456789abcdef', 'ops-riq']);
  });

  it('⛔ tentýž kid s JINÝM obsahem odmítne celý roster z adresy', () => {
    // Jinak by záznam z databáze tiše nahradil kód technika.
    const s = spojSeZakladem({ 'ops-riq': operator() }, { 'ops-riq': operator() }, {});
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.duvod).toMatch(/ops-riq/);
  });

  it('totožný záznam v základu i z adresy kolize není', () => {
    const z = operator();
    expect(spojSeZakladem({ 'dev-a': z }, { 'dev-a': { ...z } }, {}).ok).toBe(true);
  });

  it('kid, který z adresy zmizel, se hlásí jako odvolaný; kid ze základu nikdy', () => {
    const t = operator();
    const s = spojSeZakladem({ 'ops-riq': t }, {}, { 'dev-b': operator(), 'ops-riq': t });
    expect(s.ok && s.odebrane).toEqual(['dev-b']);
  });
});

describe('obnovovací smyčka se základem', () => {
  it('nastaví základ + adresu a odvolanému zavře dveře', async () => {
    const technik = operator({ kind: 'person' });
    let roster: Record<string, Operator> = { 'dev-a': operator(), 'dev-b': operator() };
    let verze = 'v1';
    const f = vi.fn(async (url: string | URL | Request) =>
      String(url) === ZDROJ.versionUrl
        ? new Response(JSON.stringify({ version: verze, count: Object.keys(roster).length }), { status: 200 })
        : new Response(JSON.stringify(roster), { status: 200 }),
    ) as unknown as typeof fetch;
    const nastav = vi.fn();
    const odvolano = vi.fn();
    const o = spustObnovuRosteru(ZDROJ, { nastav, odvolano, zaklad: { 'ops-riq': technik }, log: () => {}, fetchImpl: f });

    await o.kolo();
    expect(Object.keys(nastav.mock.calls[0][0]).sort()).toEqual(['dev-a', 'dev-b', 'ops-riq']);
    expect(odvolano).not.toHaveBeenCalled();

    roster = { 'dev-a': roster['dev-a'] };
    verze = 'v2';
    await o.kolo();
    expect(Object.keys(nastav.mock.calls[1][0]).sort()).toEqual(['dev-a', 'ops-riq']);
    expect(odvolano).toHaveBeenCalledWith('dev-b');
    o.stop();
  });

  it('⛔ kolize se základem: nic se nenastaví a verze se nezapamatuje (zkusí se znovu)', async () => {
    const f = fakeFetch({
      [ZDROJ.versionUrl]: { version: 'v1', count: 1 },
      [ZDROJ.url]: { 'ops-riq': operator() },
    });
    const nastav = vi.fn();
    const zaznamy: Record<string, unknown>[] = [];
    const o = spustObnovuRosteru(ZDROJ, { nastav, zaklad: { 'ops-riq': operator() }, log: (u) => zaznamy.push(u), fetchImpl: f });
    await o.kolo();
    await o.kolo();
    expect(nastav).not.toHaveBeenCalled();
    expect(o.pripraven()).toBe(false);
    expect(zaznamy.filter((z) => z.ev === 'roster-odmitnut')).toHaveLength(2);
    o.stop();
  });
});
