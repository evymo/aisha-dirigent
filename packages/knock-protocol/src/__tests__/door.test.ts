import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { parseTrusted } from '../client-ip.js';
import { createDoor } from '../door.js';

/**
 * Náhrada Redisu jen pro to, co dveře používají. Vlastní, ne knihovna:
 * potřebujeme umět úložiště ROZBÍT na povel, protože právě to chování
 * (fail-closed) je tu ta měřená vlastnost.
 */
function fakeRedis() {
  const retezce = new Map<string, { v: string; ttl: number }>();
  const mnoziny = new Map<string, Set<string>>();
  const stav = { rozbity: false };

  const proveď = (op: string, args: unknown[]): unknown => {
    if (stav.rozbity) throw new Error('redis je dole');
    const key = String(args[0]);
    switch (op) {
      case 'set':
        retezce.set(key, { v: String(args[1]), ttl: Number(args[3]) });
        return 'OK';
      case 'get':
        return retezce.get(key)?.v ?? null;
      case 'ttl':
        return retezce.has(key) ? retezce.get(key)!.ttl : -2;
      case 'sadd': {
        const s = mnoziny.get(key) ?? new Set<string>();
        s.add(String(args[1]));
        mnoziny.set(key, s);
        return 1;
      }
      case 'smembers':
        return [...(mnoziny.get(key) ?? [])];
      case 'expire':
        return 1;
      case 'srem': {
        // Atrapa `srem` chyběla, takže `close()` v ní padalo a vypadalo to jako
        // vada kódu. Test double musí umět KAŽDOU operaci, kterou měřený kód
        // volá — jinak měří sebe.
        const s = mnoziny.get(key);
        if (!s) return 0;
        let n = 0;
        for (const v of args.slice(1)) if (s.delete(String(v))) n += 1;
        return n;
      }
      case 'del':
        return (retezce.delete(key) ? 1 : 0) + (mnoziny.delete(key) ? 1 : 0);
      default:
        throw new Error(`fakeRedis neumí ${op}`);
    }
  };

  const klient = {
    stav,
    retezce,
    async get(k: string) { return proveď('get', [k]); },
    async smembers(k: string) { return proveď('smembers', [k]) as string[]; },
    async del(k: string) { return proveď('del', [k]) as number; },
    async ping() { if (stav.rozbity) throw new Error('redis je dole'); return 'PONG'; },
    multi() {
      const fronta: Array<[string, unknown[]]> = [];
      const chain = {
        set: (...a: unknown[]) => { fronta.push(['set', a]); return chain; },
        get: (...a: unknown[]) => { fronta.push(['get', a]); return chain; },
        ttl: (...a: unknown[]) => { fronta.push(['ttl', a]); return chain; },
        sadd: (...a: unknown[]) => { fronta.push(['sadd', a]); return chain; },
        expire: (...a: unknown[]) => { fronta.push(['expire', a]); return chain; },
        srem: (...a: unknown[]) => { fronta.push(['srem', a]); return chain; },
        del: (...a: unknown[]) => { fronta.push(['del', a]); return chain; },
        async exec() {
          return fronta.map(([op, a]) => [null, proveď(op, a)] as [null, unknown]);
        },
      };
      return chain;
    },
  };
  return klient as unknown as Redis & { stav: { rozbity: boolean } };
}

const KANCELAR = parseTrusted(['198.51.100.0/24']);
const ZAKAZ = parseTrusted(['203.0.113.66']);

describe('dveře — pořadí rozhodování', () => {
  it('zákaz je silnější než statická výjimka, jinak by nebyl zákazem', async () => {
    const r = fakeRedis();
    const d = createDoor({
      redis: r,
      staticAllow: parseTrusted(['203.0.113.66']),
      blacklist: ZAKAZ,
      ttlSec: 120,
    });
    expect(await d.verdict('203.0.113.66')).toEqual({ allowed: false, via: 'blacklist' });
  });

  it('⭐ statická výjimka platí i BEZ úložiště — to je ta záchranná cesta (K4)', async () => {
    const d = createDoor({ redis: null, staticAllow: KANCELAR, ttlSec: 120 });
    expect(await d.verdict('198.51.100.20')).toEqual({ allowed: true, via: 'static' });
  });

  it('bez úložiště a bez výjimky se zavírá, ne otevírá', async () => {
    const d = createDoor({ redis: null, staticAllow: KANCELAR, ttlSec: 120 });
    expect(await d.verdict('1.2.3.4')).toEqual({ allowed: false, via: 'store-down' });
  });

  it('„nevím, kdo je klient" NENÍ důvod pustit', async () => {
    const d = createDoor({ redis: fakeRedis(), ttlSec: 120 });
    expect(await d.verdict(null)).toEqual({ allowed: false, via: 'unknown-client' });
  });
});

describe('dveře — zaťukání a otvor', () => {
  it('po otevření je adresa uvnitř a je vidět čí', async () => {
    const d = createDoor({ redis: fakeRedis(), ttlSec: 120 });
    expect(await d.open('1.2.3.4', 'dev-abc')).toBe(true);
    const v = await d.verdict('1.2.3.4');
    expect(v).toMatchObject({ allowed: true, via: 'knock', kid: 'dev-abc' });
  });

  it('cizí adresa zůstává venku', async () => {
    const d = createDoor({ redis: fakeRedis(), ttlSec: 120 });
    await d.open('1.2.3.4', 'dev-abc');
    expect(await d.verdict('9.9.9.9')).toEqual({ allowed: false, via: 'closed' });
  });

  it('zakázané místo nejde otevřít ani platným zaťukáním', async () => {
    const d = createDoor({ redis: fakeRedis(), blacklist: ZAKAZ, ttlSec: 120 });
    expect(await d.open('203.0.113.66', 'dev-abc')).toBe(false);
    expect(await d.verdict('203.0.113.66')).toEqual({ allowed: false, via: 'blacklist' });
  });

  it('odvolání zařízení zavře i to, co má PRÁVĚ otevřené', async () => {
    const d = createDoor({ redis: fakeRedis(), ttlSec: 120 });
    await d.open('1.2.3.4', 'dev-abc');
    await d.open('5.6.7.8', 'dev-abc');
    await d.open('9.9.9.9', 'dev-jiny');

    expect(await d.closeForKid('dev-abc')).toBe(2);
    expect(await d.verdict('1.2.3.4')).toEqual({ allowed: false, via: 'closed' });
    expect(await d.verdict('5.6.7.8')).toEqual({ allowed: false, via: 'closed' });
    // Cizí zařízení se odvoláním nesmí dotknout.
    expect(await d.verdict('9.9.9.9')).toMatchObject({ allowed: true, kid: 'dev-jiny' });
  });
});

describe('dveře — výpadek úložiště', () => {
  it('⛔ rozbitý Redis zavírá (fail-closed) — a hlásí to JINÝM důvodem než „zavřeno"', async () => {
    const r = fakeRedis();
    const d = createDoor({ redis: r, ttlSec: 120 });
    await d.open('1.2.3.4', 'dev-abc');
    expect(await d.verdict('1.2.3.4')).toMatchObject({ allowed: true });

    r.stav.rozbity = true;
    // Kdyby se výpadek převyprávěl na `closed`, obsluha by hledala chybu
    // u uživatele místo u úložiště.
    expect(await d.verdict('1.2.3.4')).toEqual({ allowed: false, via: 'store-down' });
  });

  it('při rozbitém úložišti se otevřít nedá — a řekne se to', async () => {
    const r = fakeRedis();
    const d = createDoor({ redis: r, ttlSec: 120 });
    r.stav.rozbity = true;
    expect(await d.open('1.2.3.4', 'dev-abc')).toBe(false);
  });

  it('⭐ ani rozbitý Redis neodstřihne záchrannou cestu', async () => {
    const r = fakeRedis();
    const d = createDoor({ redis: r, staticAllow: KANCELAR, ttlSec: 120 });
    r.stav.rozbity = true;
    expect(await d.verdict('198.51.100.20')).toEqual({ allowed: true, via: 'static' });
  });
});

/**
 * BRÁNA: nájem adresy se váže na RELACI, ne na hodiny.
 *
 * Rozhodnutí majitele 2026-09-01: „přihlášení whitelistuje uživatelovu IP na
 * edge — dokud je přihlášen, nebo dokud ho neodhlásíš z KC."
 *
 * ⛔ Vědomě přijaté omezení (majitel potvrdil): dveře drží ADRESU, ne osobu.
 * Za jednou veřejnou IP (NAT, kancelář, operátor) tím projde každý — k PLOŠE,
 * ne k datům; tam dál platí přihlášení a RLS.
 */
describe('brána: nájem se váže na relaci', () => {
  it('prodloužení NEOTEVÍRÁ adresu, která nezaťukala', async () => {
    // Tohle je ta bezpečnostní vlastnost. Kdyby prodloužení umělo otevírat,
    // stačil by platný token z cizí sítě a zaťukání by přestalo být podmínkou.
    const d = createDoor({ redis: fakeRedis(), ttlSec: 120 });
    expect(await d.prodluz('9.9.9.9')).toBe(false);
    expect((await d.verdict('9.9.9.9')).allowed).toBe(false);
  });

  it('prodloužení otevřené adresy uspěje a nechá ji otevřenou', async () => {
    const d = createDoor({ redis: fakeRedis(), ttlSec: 120 });
    await d.open('1.2.3.4', 'kid-a');
    expect(await d.prodluz('1.2.3.4')).toBe(true);
    expect((await d.verdict('1.2.3.4')).allowed).toBe(true);
  });

  it('zavření je OKAMŽITÉ — nečeká se na TTL', async () => {
    const d = createDoor({ redis: fakeRedis(), ttlSec: 120 });
    await d.open('1.2.3.4', 'kid-a');
    expect((await d.verdict('1.2.3.4')).allowed).toBe(true);
    await d.close('1.2.3.4');
    expect((await d.verdict('1.2.3.4')).allowed).toBe(false);
  });
});

describe('dveře — ping měří mapu, ne existenci klienta', () => {
  it('živá mapa odpoví PONG', async () => {
    const d = createDoor({ redis: fakeRedis(), ttlSec: 120 });
    expect(await d.ping()).toBe(true);
  });

  it('⛔ klient existuje, mapa je dole → NE (dřív /ready hlásilo 200 podle hasStore)', async () => {
    const r = fakeRedis();
    r.stav.rozbity = true;
    const chyby: string[] = [];
    const d = createDoor({ redis: r, ttlSec: 120, onError: (op) => chyby.push(op) });
    expect(d.hasStore(), 'hasStore je pravda i s mrtvou mapou — proto nesmí rozhodovat').toBe(true);
    expect(await d.ping()).toBe(false);
    expect(chyby, 'výpadek mapy se musí ozvat').toEqual(['ping']);
  });

  it('⛔ mapa neodpovídá vůbec (mrtvý netns, fronta offline) → NE do limitu, ne visení', async () => {
    const visici = { ping: () => new Promise<string>(() => {}) } as unknown as Redis;
    const d = createDoor({ redis: visici, ttlSec: 120 });
    const t0 = Date.now();
    expect(await d.ping(50)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('bez úložiště není co pingnout', async () => {
    expect(await createDoor({ redis: null, ttlSec: 120 }).ping()).toBe(false);
  });
});
