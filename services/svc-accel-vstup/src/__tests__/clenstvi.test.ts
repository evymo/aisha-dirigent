// O-2: „bez klíče B se z <B>-lane nic neobslouží“ + hlídač členství. Cizí kontejner na síti
// nájemce vypne jen toho nájemce (i s platným klíčem); na jádře nebo bez aktuálního měření
// neobslouží VB nikoho (NEZMĚŘENO ≠ v pořádku).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Clenstvi, MEZ_CERSTVOSTI_MS, rozhodniClenstvi, type StavClenstvi } from '../clenstvi.js';
import { Kvoty, knihaVPameti } from '../kvoty.js';
import type { Pripravenost } from '../pripravenost.js';
import { vytvorVstup } from '../vstup.js';
import { postavTabulku } from '../tabulka.js';
import { IP_ALFA, IP_Z, KLIC_ALFA, KLIC_Z, OTISK_DEKLARACE, clenstviOk, uzel } from './fixtura.js';

const TED = Date.parse('2026-10-05T07:00:00.000Z');

describe('rozhodnutí podle měření', () => {
  it('kotva: čerstvé měření, sítě čisté → obsluhuje se', () => {
    expect(rozhodniClenstvi(clenstviOk(['z', 'alfa'], TED), 'alfa', TED)).toBeNull();
    expect(rozhodniClenstvi(clenstviOk(['z', 'alfa'], TED), null, TED)).toBeNull();
  });
  it('cizí kontejner na síti ALFA → NAJEMCE_VYPNUT jen ALFA; Z dál', () => {
    const m = clenstviOk(['z', 'alfa'], TED);
    m.najemci.alfa = { ok: false, cizi: ['beta-odposlech'] };
    expect(rozhodniClenstvi(m, 'alfa', TED)?.duvod).toBe('NAJEMCE_VYPNUT');
    expect(rozhodniClenstvi(m, 'z', TED)).toBeNull();
  });
  it('cizí kontejner na síti jádra → LANE_NEDOSTUPNA všem (obešel by VB a mluvil s vLLM)', () => {
    const m = clenstviOk(['z', 'alfa'], TED);
    m.jadro = { ok: false, cizi: ['alfa-pruzkum'] };
    for (const n of ['z', 'alfa', null]) expect(rozhodniClenstvi(m, n, TED)?.duvod).toBe('LANE_NEDOSTUPNA');
  });
  it('nezměřeno: soubor nečitelný, měření staré nebo z budoucnosti, síť nájemce chybí → LANE_NEDOSTUPNA', () => {
    expect(rozhodniClenstvi({ necitelne: 'x' }, 'z', TED)?.duvod).toBe('LANE_NEDOSTUPNA');
    expect(rozhodniClenstvi(clenstviOk(['z'], TED - MEZ_CERSTVOSTI_MS - 1), 'z', TED)?.duvod).toBe('LANE_NEDOSTUPNA');
    expect(rozhodniClenstvi(clenstviOk(['z'], TED - MEZ_CERSTVOSTI_MS + 1000), 'z', TED)).toBeNull();
    expect(rozhodniClenstvi(clenstviOk(['z'], TED + 60_000), 'z', TED)?.duvod).toBe('LANE_NEDOSTUPNA');
    expect(rozhodniClenstvi(clenstviOk(['z'], TED), 'alfa', TED)?.duvod).toBe('LANE_NEDOSTUPNA');
  });
});

describe('vstup s měřením členství', () => {
  const ZA_Z = { 'x-test-lokalni': IP_Z.vstup, 'x-test-vzdalena': IP_Z.klient };
  const ZA_ALFA = { 'x-test-lokalni': IP_ALFA.vstup, 'x-test-vzdalena': IP_ALFA.klient };
  function vstup(clenstvi: () => StavClenstvi) {
    const r = postavTabulku(uzel());
    if ('vady' in r) throw new Error(r.vady.join('\n'));
    return vytvorVstup({
      tabulka: () => r.tabulka,
      pripravenost: { rozhodni: () => null } as unknown as Pripravenost,
      clenstvi,
      kvoty: new Kvoty(knihaVPameti()),
      upstream: { post: async () => ({ status: 200, telo: {} }) },
      adresy: (req) => ({ lokalni: String(req.headers['x-test-lokalni'] ?? ''), vzdalena: String(req.headers['x-test-vzdalena'] ?? '') }),
    });
  }
  const modely = (app: FastifyInstance, za: Record<string, string>, klic: string) => app.inject({ method: 'GET', url: '/v1/models', headers: { ...za, authorization: `Bearer ${klic}` } });

  it('cizí kontejner na síti ALFA: ALFA s PLATNÝM klíčem odmítnut (klíč mohl uniknout), Z beze změny', async () => {
    const m = clenstviOk();
    m.najemci.alfa = { ok: false, cizi: ['beta-odposlech'] };
    const app = vstup(() => ({ ...m, zmereno: new Date().toISOString() }));
    const alfa = await modely(app, ZA_ALFA, KLIC_ALFA);
    expect([alfa.statusCode, alfa.json().duvod, alfa.headers['x-aisha-odmitl']]).toEqual([403, 'NAJEMCE_VYPNUT', 'vstup']);
    expect(JSON.stringify(alfa.json()), 'jméno cizího kontejneru nájemci nepatří').not.toContain('beta');
    expect((await modely(app, ZA_Z, KLIC_Z)).statusCode).toBe(200);
  });

  it('bez měření (hlídač neběží) neobslouží nikoho — ani s platným klíčem', async () => {
    const app = vstup(() => ({ necitelne: 'soubor nejde přečíst (ENOENT)' }));
    for (const [za, k] of [[ZA_Z, KLIC_Z], [ZA_ALFA, KLIC_ALFA]] as const) {
      expect((await modely(app, za, k)).json().duvod).toBe('LANE_NEDOSTUPNA');
    }
  });
});

describe('soubor měření za běhu', () => {
  let d: string;
  let soubor: string;
  beforeAll(() => {
    d = mkdtempSync(join(tmpdir(), 'vb-clenstvi-'));
    soubor = join(d, 'clenstvi.json');
  });
  afterAll(() => rmSync(d, { recursive: true, force: true }));

  it('cizí kontejner se ohlásí JEDNOU při změně (alarm), návrat do pořádku taky; opakovaný zápis nic', () => {
    const hlaseni: Array<[string, Record<string, unknown>]> = [];
    const c = new Clenstvi(soubor, () => OTISK_DEKLARACE, (u, x) => hlaseni.push([u, x]));
    const spatne = clenstviOk();
    spatne.najemci.alfa = { ok: false, cizi: ['beta-odposlech'] };
    writeFileSync(soubor, JSON.stringify(spatne));
    c.nacti();
    writeFileSync(soubor, JSON.stringify({ ...spatne, zmereno: new Date(Date.now() + 1000).toISOString() }));
    c.nacti();
    writeFileSync(soubor, JSON.stringify(clenstviOk()));
    c.nacti();
    expect(hlaseni.map(([u]) => u)).toEqual(['clenstvi_cizi', 'clenstvi_v_poradku']);
    expect(hlaseni[0][1]).toEqual({ jadro: [], najemci: { alfa: ['beta-odposlech'] } });
  });

  it('neplatný tvar nebo neznámé pole = nečitelné, ne „čisté“', () => {
    const c = new Clenstvi(soubor, () => OTISK_DEKLARACE);
    for (const vadne of ['{', JSON.stringify({ ...clenstviOk(), navic: 1 }), JSON.stringify({ ...clenstviOk(), verze: 2 }), JSON.stringify({ ...clenstviOk(), jadro: { ok: true } })]) {
      writeFileSync(soubor, vadne);
      c.nacti();
      expect('necitelne' in c.stav(), vadne.slice(0, 40)).toBe(true);
    }
    rmSync(soubor);
    c.nacti();
    expect(c.stav()).toEqual({ necitelne: expect.stringMatching(/ENOENT/) });
  });

  it('měření k JINÉ deklaraci (nebo VB bez platné deklarace) = nečitelné — schválení se nepřenáší', () => {
    let otisk = OTISK_DEKLARACE;
    const c = new Clenstvi(soubor, () => otisk);
    writeFileSync(soubor, JSON.stringify(clenstviOk()));
    c.nacti();
    expect('necitelne' in c.stav(), 'kotva').toBe(false);
    otisk = 'e'.repeat(64);
    expect(c.stav()).toEqual({ necitelne: expect.stringMatching(/jiné deklaraci/) });
    otisk = '';
    expect('necitelne' in c.stav()).toBe(true);
  });

  it('varování (root přístup k uzlu) se ohlásí při změně, ale nic nevypne', () => {
    const hlaseni: string[] = [];
    const c = new Clenstvi(soubor, () => OTISK_DEKLARACE, (u) => hlaseni.push(u));
    writeFileSync(soubor, JSON.stringify({ ...clenstviOk(), varovani: ['alfa-x: privileged'] }));
    c.nacti();
    expect(hlaseni).toContain('clenstvi_varovani');
    expect(rozhodniClenstvi(c.stav(), 'alfa', Date.now())).toBeNull();
  });
});
