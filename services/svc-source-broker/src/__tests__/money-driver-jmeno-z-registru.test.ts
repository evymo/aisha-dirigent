/**
 * Faktura se doručuje pod jménem, které registr pro týž `money_id` UŽ ZNÁ.
 *
 * ⛔ NAMĚŘENO 2026-09-25 v produkci instance. První den tahu faktur po jménu exportu
 * (`money-faktura_vydana-<číslo>-<ID8>.json`) založil 164 druhých řádků registru
 * k fakturám, které registr znal jen pod jménem z dřívějšího tahu téže linky
 * (`<agenda>-<číslo>.json`, někdy `…-10.json` — příponu ze vzorce odvodit NEJDE).
 * Identita řádku registru je `filename`, takže jiné jméno = druhý řádek.
 *
 * ⭐ CO SE MĚŘÍ:
 * - vypočtené jméno má přednost, když ho registr zná nebo nezná žádné
 * - jediné jiné známé jméno vyhraje → úplná verze přepíše neúplnou NA MÍSTĚ
 * - víc známých jmen, žádné vypočtené → doklad se NEDORUČÍ a ohlásí (žádné hádání)
 * - druh s `jmenoZRegistru` bez dotazu na registr = STOP dvojice, ne tichý přeskok
 * - chyba dotazu = chyba dvojice (kurzor stojí), ne doručení pod vypočteným jménem
 * - dotaz do registru jde jen pro dávku, ne pro celé okno, a jen pro druh, který ho chce
 */
import { describe, it, expect, vi } from 'vitest';
import { pullAgenda, vyberJmeno, type MoneyClient } from '../clients/money-driver.js';
import { DRUHY_DOKLADU, jmenaVRegistru } from '../clients/money-lane.js';

const FAKTURA = DRUHY_DOKLADU.find((d) => d.marker === 'money.faktura_vydana')!;
const DODAK = DRUHY_DOKLADU.find((d) => d.marker === 'money.dodaci_list')!;
const AG = { key: 'areal-avant-dablicka', label: 'Areál Avant' };
const firma = (a: { key: string; label?: string }) => a.label ?? null;
const tichy = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

type Radek = { ID: string; CisloDokladu: string; DatumVystaveni: string };
const fa = (id: string, cislo: string): Radek => ({ ID: id, CisloDokladu: cislo, DatumVystaveni: '2026-09-01T00:00:00' });

function klient(rejstrik: Radek[]) {
  const c: MoneyClient = {
    async query(_a, q) {
      if (q.includes('NeexistujiciEntitaProSondu')) return { errors: [{ message: 'unknown' }] };
      if (q.includes('IssuedInvoices(')) return { data: { IssuedInvoices: rejstrik } };
      if (q.includes('IssuedDeliveryNotes(')) return { data: { IssuedDeliveryNotes: rejstrik } };
      const det = q.match(/Issued(Invoice|DeliveryNote)\(ID: "([^"]+)"\)/);
      if (det) return { data: { [`Issued${det[1]}`]: rejstrik.find((r) => r.ID === det[2]) } };
      return { errors: [{ message: 'nepodvržený dotaz' }] };
    },
    async lease() { return 'L'; },
    async release() {},
    async listAgendas() { return []; },
  };
  return c;
}

const ID1 = 'c244006e-bf5e-46b6-800e-0441e8aba386';
const ID2 = 'b3e6fb9a-6842-47e0-bc0d-ce74fffc696b';
const EXPORT1 = 'money-faktura_vydana-FV62600248-c244006e.json';
const EXPORT2 = 'money-faktura_vydana-FV62600268-b3e6fb9a.json';

describe('vyberJmeno — čistá pravidla', () => {
  it('registr jméno nezná → vypočtené', () => {
    expect(vyberJmeno(EXPORT1, undefined)).toEqual({ jmeno: EXPORT1 });
    expect(vyberJmeno(EXPORT1, [])).toEqual({ jmeno: EXPORT1 });
  });
  it('registr zná vypočtené (i vedle jiného) → vypočtené', () => {
    expect(vyberJmeno(EXPORT1, [EXPORT1])).toEqual({ jmeno: EXPORT1 });
    expect(vyberJmeno(EXPORT1, ['areal-avant-dablicka-FV62600248-10.json', EXPORT1])).toEqual({ jmeno: EXPORT1 });
  });
  it('registr zná JEDINÉ jiné jméno → to jméno (aktualizace na místě)', () => {
    expect(vyberJmeno(EXPORT1, ['areal-avant-dablicka-FV62600248-10.json']))
      .toEqual({ jmeno: 'areal-avant-dablicka-FV62600248-10.json' });
  });
  it('víc jiných jmen, žádné vypočtené → nejasné, žádné hádání', () => {
    const r = vyberJmeno(EXPORT1, ['a-FV1.json', 'a-FV1-10.json']);
    expect(r).toEqual({ nejasne: ['a-FV1.json', 'a-FV1-10.json'] });
  });
});

describe('tah faktur doručuje pod jménem z registru', () => {
  it('faktura známá jen pod dřívějším jménem jde pod NÍM; neznámá pod jménem exportu', async () => {
    const dotazy: Array<{ ids: readonly string[]; docType: string }> = [];
    const jmena = async (ids: readonly string[], docType: string) => {
      dotazy.push({ ids, docType });
      return new Map([[ID1, ['areal-avant-dablicka-FV62600248-10.json']]]);
    };
    const r = await pullAgenda(klient([fa(ID1, 'FV62600248'), fa(ID2, 'FV62600268')]), AG, FAKTURA,
      { since: '2026-09-18', known: new Set(), maxNew: 50, firma, datumTahu: '2026-09-25', jmenaVRegistru: jmena }, tichy() as never);
    expect(r.documents.map((d) => d.name)).toEqual(['areal-avant-dablicka-FV62600248-10.json', EXPORT2]);
    expect(dotazy).toEqual([{ ids: [ID1, ID2], docType: 'invoice' }]);
    expect(r.preskoceno ?? 0).toBe(0);
  });

  it('nejasné jméno: doklad se NEDORUČÍ, ohlásí se a dvojice není úplná (kurzor stojí)', async () => {
    const log = tichy();
    const jmena = async () => new Map([[ID1, ['a-FV62600248.json', 'a-FV62600248-10.json']]]);
    const r = await pullAgenda(klient([fa(ID1, 'FV62600248'), fa(ID2, 'FV62600268')]), AG, FAKTURA,
      { since: '2026-09-18', known: new Set(), maxNew: 50, firma, datumTahu: '2026-09-25', jmenaVRegistru: jmena }, log as never);
    expect(r.documents.map((d) => d.name)).toEqual([EXPORT2]);
    expect(r.nejasnaJmena).toBe(1);
    expect(r.preskoceno).toBe(1);
    expect(log.error.mock.calls.some((c) => String(c[1]).includes('víc jmen'))).toBe(true);
  });

  it('druh, který jméno z registru chce, bez dotazu na registr = STOP (ne doručení pod vypočteným jménem)', async () => {
    await expect(pullAgenda(klient([fa(ID1, 'FV62600248')]), AG, FAKTURA,
      { since: '2026-09-18', known: new Set(), maxNew: 50, firma, datumTahu: '2026-09-25' }, tichy() as never))
      .rejects.toThrow('vyžaduje dotaz na jména v registru');
  });

  it('selhaný dotaz do registru shodí dvojici — nic se nedoručí pod vypočteným jménem', async () => {
    const jmena = async () => { throw new Error('statement timeout'); };
    await expect(pullAgenda(klient([fa(ID1, 'FV62600248')]), AG, FAKTURA,
      { since: '2026-09-18', known: new Set(), maxNew: 50, firma, datumTahu: '2026-09-25', jmenaVRegistru: jmena }, tichy() as never))
      .rejects.toThrow('statement timeout');
  });

  it('dotaz jde jen pro DÁVKU (strop běhu), ne pro celé okno', async () => {
    const dotazy: Array<readonly string[]> = [];
    const jmena = async (ids: readonly string[]) => { dotazy.push(ids); return new Map<string, string[]>(); };
    await pullAgenda(klient([fa(ID1, 'FV62600248'), fa(ID2, 'FV62600268')]), AG, FAKTURA,
      { since: '2026-09-18', known: new Set(), maxNew: 1, firma, datumTahu: '2026-09-25', jmenaVRegistru: jmena }, tichy() as never);
    expect(dotazy).toEqual([[ID1]]);
  });

  it('dodací list se registru neptá (druh bez jmenoZRegistru)', async () => {
    const jmena = vi.fn(async () => new Map<string, string[]>());
    const r = await pullAgenda(klient([{ ID: 'd1', CisloDokladu: 'DLP1', DatumVystaveni: '2026-09-20T00:00:00' }]), AG, DODAK,
      { since: '2026-09-18', known: new Set(), maxNew: 50, firma, jmenaVRegistru: jmena }, tichy() as never);
    expect(jmena).not.toHaveBeenCalled();
    expect(r.documents[0]!.name).toBe('areal-avant-dablicka-DLP1.json');
  });
});

describe('jmenaVRegistru — dotaz do registru', () => {
  it('ptá se podle money_id a doc_type, jen čtení, a skládá jména po ID', async () => {
    const volani: Array<{ sql: string; params: unknown[] }> = [];
    const pg = {
      async query(sql: string, params: unknown[]) {
        volani.push({ sql, params });
        return { rows: [
          { mid: ID1, filename: 'areal-avant-dablicka-FV62600248-10.json' },
          { mid: ID1, filename: EXPORT1 },
          { mid: ID1, filename: EXPORT1 },
          { mid: ID2, filename: EXPORT2 },
        ] };
      },
    };
    const m = await jmenaVRegistru(pg as never, [ID1, ID2], 'invoice');
    expect(m.get(ID1)).toEqual(['areal-avant-dablicka-FV62600248-10.json', EXPORT1]);
    expect(m.get(ID2)).toEqual([EXPORT2]);
    expect(volani).toHaveLength(1);
    expect(volani[0]!.sql).toMatch(/^\s*select\b/i);
    expect(volani[0]!.sql).toContain("fields->'money_id'->>'value'");
    expect(volani[0]!.params).toEqual([[ID1, ID2], 'invoice']);
  });

  it('prázdný seznam ID = žádný dotaz', async () => {
    const pg = { query: vi.fn() };
    expect((await jmenaVRegistru(pg as never, [], 'invoice')).size).toBe(0);
    expect(pg.query).not.toHaveBeenCalled();
  });
});
