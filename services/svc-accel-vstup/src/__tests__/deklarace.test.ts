// Výměna deklarace za běhu: rotace klíče a vypínač bez restartu (KJ2, MN4); nečitelná
// deklarace = DEKLARACE_NECITELNA pro všechny, ne stará tabulka (X3, MN5).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Deklarace } from '../deklarace.js';
import type { Pripravenost } from '../pripravenost.js';
import { Kvoty, knihaVPameti } from '../kvoty.js';
import { vytvorVstup } from '../vstup.js';
import { IP_ALFA, IP_Z, KLIC_ALFA, KLIC_ALFA_NOVY, KLIC_Z, clenstviOk, otisk, uzel } from './fixtura.js';

let d: string;
let soubor: string;
beforeAll(() => {
  d = mkdtempSync(join(tmpdir(), 'vb-deklarace-'));
  soubor = join(d, 'uzel.json');
});
afterAll(() => rmSync(d, { recursive: true, force: true }));

const zapis = (u: unknown) => writeFileSync(soubor, typeof u === 'string' ? u : JSON.stringify(u));
const ZA_Z = { 'x-test-lokalni': IP_Z.vstup, 'x-test-vzdalena': IP_Z.klient };
const ZA_ALFA = { 'x-test-lokalni': IP_ALFA.vstup, 'x-test-vzdalena': IP_ALFA.klient };

function vstup(dek: Deklarace) {
  return vytvorVstup({
    tabulka: () => dek.tabulka(),
    pripravenost: { rozhodni: () => null } as unknown as Pripravenost,
    clenstvi: () => clenstviOk(),
    kvoty: new Kvoty(knihaVPameti()),
    upstream: { post: async () => ({ status: 200, telo: { object: 'list', data: [] } }) },
    adresy: (req) => ({ lokalni: String(req.headers['x-test-lokalni'] ?? ''), vzdalena: String(req.headers['x-test-vzdalena'] ?? '') }),
  });
}
const modely = (app: FastifyInstance, za: Record<string, string>, klic: string) => app.inject({ method: 'GET', url: '/v1/models', headers: { ...za, authorization: `Bearer ${klic}` } });

describe('deklarace za běhu', () => {
  it('rotace klíče ALFA: [starý,nový] → [nový]; Z během celé rotace bez jediné chyby, bez restartu (KJ2)', async () => {
    zapis(uzel());
    const dek = new Deklarace(soubor);
    dek.nacti();
    const app = vstup(dek);
    const chybyZ: number[] = [];
    let bezi = true;
    const rada = (async () => {
      while (bezi) {
        const r = await modely(app, ZA_Z, KLIC_Z);
        if (r.statusCode !== 200) chybyZ.push(r.statusCode);
        await new Promise((x) => setTimeout(x, 5));
      }
    })();

    zapis(uzel((u) => (u.najemci.alfa.otisky = [otisk(KLIC_ALFA), otisk(KLIC_ALFA_NOVY)])));
    expect(dek.nacti()).toBe(true);
    expect((await modely(app, ZA_ALFA, KLIC_ALFA)).statusCode).toBe(200);
    expect((await modely(app, ZA_ALFA, KLIC_ALFA_NOVY)).statusCode).toBe(200);

    zapis(uzel((u) => (u.najemci.alfa.otisky = [otisk(KLIC_ALFA_NOVY)])));
    expect(dek.nacti()).toBe(true);
    expect((await modely(app, ZA_ALFA, KLIC_ALFA)).json().duvod).toBe('KLIC_NEPLATNY');
    expect((await modely(app, ZA_ALFA, KLIC_ALFA_NOVY)).statusCode).toBe(200);

    bezi = false;
    await rada;
    expect(chybyZ, 'Z dostal během rotace ALFA chybu').toEqual([]);
  });

  it('místní vypínač: vypnuto ALFA = NAJEMCE_VYPNUT do dalšího čtení, Z běží; zapnutí vrací provoz', async () => {
    zapis(uzel());
    const dek = new Deklarace(soubor);
    dek.nacti();
    const app = vstup(dek);
    zapis(uzel((u) => (u.najemci.alfa.vypnuto = true)));
    dek.nacti();
    expect((await modely(app, ZA_ALFA, KLIC_ALFA)).json().duvod).toBe('NAJEMCE_VYPNUT');
    expect((await modely(app, ZA_Z, KLIC_Z)).statusCode).toBe(200);
    zapis(uzel());
    dek.nacti();
    expect((await modely(app, ZA_ALFA, KLIC_ALFA)).statusCode).toBe(200);
  });

  it('rozbitý soubor = DEKLARACE_NECITELNA pro VŠECHNY (ne stará tabulka); oprava vrací provoz (X3, MN5)', async () => {
    zapis(uzel());
    const dek = new Deklarace(soubor);
    dek.nacti();
    const app = vstup(dek);
    expect((await modely(app, ZA_Z, KLIC_Z)).statusCode, 'kotva').toBe(200);
    for (const vadny of ['{nejson', JSON.stringify(uzel((u) => (u.najemci.z.otisky = [])))]) {
      zapis(vadny);
      dek.nacti();
      expect((await modely(app, ZA_Z, KLIC_Z)).json().duvod).toBe('DEKLARACE_NECITELNA');
      expect((await modely(app, ZA_ALFA, KLIC_ALFA)).json().duvod).toBe('DEKLARACE_NECITELNA');
    }
    zapis(uzel());
    dek.nacti();
    expect((await modely(app, ZA_Z, KLIC_Z)).statusCode).toBe(200);
  });

  it('chybějící soubor = nečitelná, ne „žádní nájemci“', () => {
    const dek = new Deklarace(join(d, 'neni.json'));
    dek.nacti();
    expect(dek.tabulka()).toEqual({ necitelna: expect.stringMatching(/nejde přečíst/) });
  });
});
