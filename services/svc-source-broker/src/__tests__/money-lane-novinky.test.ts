/**
 * Money lane: jen novinky, šetrně k zdroji — filtrovaný rejstřík, kurzor doručených, trigger.
 *
 * ⛔ NAMĚŘENO 2026-09-14 v produkci instance:
 * - rejstřík bez argumentů vrací PRVNÍCH 1000 z 21 118 dodacích listů v pořadí interního ID,
 *   takže z 3 103 dokladů roku 2026 dorazilo 438 (14,1 %); filtr `Pole~op~hodnota` přitom funguje
 * - `known` byla prázdná množina: tytéž doklady šly do ingestu každý tik → 6 809 kopií 51 dokladů
 * - pevné okno „since_days od teď" po výpadku přeskočilo doklady, které nikdo nestáhl
 *
 * ⭐ CO SE MĚŘÍ: dotaz na Money nese filtr od data a stránkuje jen výjimečně; doručený doklad
 * se nestáhne ani nepošle podruhé; okno po výpadku sahá ke kurzoru; trigger tah urychlí, ale
 * neobejde odklad ani nevyrobí souběh.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── ČÁST 1: driver nad podvrženým klientem svc-money (skutečný kód driveru) ──────────────
import { pullAgenda, filtrOdData, klicDokladu, MAX_STRANEK, type MoneyClient, type MoneyDocKind } from '../clients/money-driver.js';

const DL: MoneyDocKind = { listEntity: 'IssuedDeliveryNotes', itemEntity: 'IssuedDeliveryNote', marker: 'money.dodaci_list', detailFields: 'ID CisloDokladu' };
const tichy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function klient(rejstrik: Array<{ ID: string; CisloDokladu: string; DatumVystaveni: string }>) {
  const dotazy: string[] = [];
  const c: MoneyClient = {
    async query(_agenda, q) {
      dotazy.push(q);
      if (q.includes('NeexistujiciEntitaProSondu')) return { errors: [{ message: 'unknown' }] };
      const idx = q.match(/IssuedDeliveryNotes\(From:(\d+), Count:(\d+), Filter:"DatumVystaveni~gte~([0-9-]+)"\)/);
      if (idx) {
        const od = Number(idx[1]); const pocet = Number(idx[2]); const since = idx[3];
        return { data: { IssuedDeliveryNotes: rejstrik.filter((r) => r.DatumVystaveni.slice(0, 10) >= since).slice(od, od + pocet) } };
      }
      const det = q.match(/IssuedDeliveryNote\(ID: "([^"]+)"\)/);
      if (det) return { data: { IssuedDeliveryNote: rejstrik.find((r) => r.ID === det[1]) } };
      return { errors: [{ message: `nepodvržený dotaz ${q.slice(0, 40)}` }] };
    },
    async lease() { return 'L'; },
    async release() {},
    async listAgendas() { return [{ key: 'agenda-a' }]; },
  };
  return { c, dotazy };
}

const doklad = (i: number, datum: string) => ({ ID: `id-${i}`, CisloDokladu: `DLP26${String(i).padStart(5, '0')}`, DatumVystaveni: `${datum}T00:00:00` });

describe('driver: filtrovaný rejstřík a rozdíl proti doručeným', () => {
  it('rejstřík se ptá JEN od data, jednou stránkou; starší doklady se ani nepřenesou', async () => {
    const rejstrik = [doklad(1, '2021-03-01'), doklad(2, '2026-09-10'), doklad(3, '2026-09-14')];
    const { c, dotazy } = klient(rejstrik);
    const r = await pullAgenda(c, { key: 'agenda-a' }, DL, { since: '2026-09-10', known: new Set(), maxNew: 50 }, tichy);
    const indexy = dotazy.filter((q) => q.includes('IssuedDeliveryNotes('));
    expect(indexy).toHaveLength(1);
    expect(indexy[0]).toContain('Filter:"DatumVystaveni~gte~2026-09-10"');
    expect(r.windowRows).toBe(2);
    expect(r.documents.map((d) => d.id)).toEqual(['id-2', 'id-3']);
    expect(r.documents[1]!.datum).toBe('2026-09-14');
  });

  it('plná stránka → další stránka; krátká stránka stránkování ukončí', async () => {
    const rejstrik = Array.from({ length: 700 }, (_, i) => doklad(i, '2026-09-12'));
    const { c, dotazy } = klient(rejstrik);
    const r = await pullAgenda(c, { key: 'agenda-a' }, DL, { since: '2026-09-01', known: new Set(), maxNew: 0 }, tichy);
    const indexy = dotazy.filter((q) => q.includes('IssuedDeliveryNotes('));
    expect(indexy.map((q) => q.match(/From:(\d+)/)![1])).toEqual(['0', '500']);
    expect(r.windowRows).toBe(700);
    expect(r.windowCapped).toBe(false);
  });

  it('pojistka stránek: filtr, který nefiltruje, nestáhne celý rejstřík a ohlásí se', async () => {
    const rejstrik = Array.from({ length: (MAX_STRANEK + 3) * 500 }, (_, i) => doklad(i, '2026-09-12'));
    const { c, dotazy } = klient(rejstrik);
    const r = await pullAgenda(c, { key: 'agenda-a' }, DL, { since: '2026-01-01', known: new Set(), maxNew: 0 }, tichy);
    expect(dotazy.filter((q) => q.includes('IssuedDeliveryNotes(')).length).toBe(MAX_STRANEK);
    expect(r.windowCapped).toBe(true);
  });

  it('doručený doklad se nestahuje: detail jen pro nové, klíč nese agendu i druh', async () => {
    const rejstrik = [doklad(1, '2026-09-13'), doklad(2, '2026-09-14')];
    const { c, dotazy } = klient(rejstrik);
    const known = new Set([klicDokladu('agenda-a', 'money.dodaci_list', 'id-1')]);
    const r = await pullAgenda(c, { key: 'agenda-a' }, DL, { since: '2026-09-13', known, maxNew: 50 }, tichy);
    expect(dotazy.filter((q) => q.includes('IssuedDeliveryNote(ID')).length).toBe(1);
    expect(r.fresh).toBe(1);
    // stejné ID v JINÉ agendě doručené není
    const jinde = await pullAgenda(c, { key: 'agenda-b' }, DL, { since: '2026-09-13', known, maxNew: 50 }, tichy);
    expect(jinde.fresh).toBe(2);
  });

  it('nad strop běhu se doklady odloží a hlásí (tah pak neposune kurzor)', async () => {
    const rejstrik = Array.from({ length: 5 }, (_, i) => doklad(i, '2026-09-14'));
    const { c } = klient(rejstrik);
    const r = await pullAgenda(c, { key: 'agenda-a' }, DL, { since: '2026-09-14', known: new Set(), maxNew: 2 }, tichy);
    expect(r.documents).toHaveLength(2);
    expect(r.odlozeno).toBe(3);
  });

  it('do filtru projde jen datum', () => {
    expect(filtrOdData('2026-09-01')).toBe('DatumVystaveni~gte~2026-09-01');
    expect(() => filtrOdData('2026-09-01~or~CisloDokladu~eq~X')).toThrow();
    expect(() => filtrOdData('"){ IssuedInvoices')).toThrow();
  });
});

// ── ČÁST 2: čisté funkce okna a kurzoru ─────────────────────────────────────────────────
import { oknoOd, posunKurzor } from '../clients/money-lane.js';

const T = Date.parse('2026-09-14T10:00:00Z');
const agendaOk = { agenda: 'agenda-a', kind: 'money.dodaci_list', windowRows: 1, windowCapped: false, fresh: 1, documents: [], unreachable: false, odlozeno: 0 };

describe('okno a kurzor', () => {
  it('bez kurzoru okno z politiky; běžně politika; po výpadku až ke kurzoru (s dnem překryvu)', () => {
    expect(oknoOd(T, 2, null)).toBe('2026-09-12');
    expect(oknoOd(T, 2, '2026-09-14')).toBe('2026-09-12');
    expect(oknoOd(T, 2, '2026-09-08')).toBe('2026-09-07');
  });

  it('úplný tah posune `od` své dvojice; nedostupná agenda, chyba, pojistka i odložené ho nechají', () => {
    const K = 'agenda-a/money.dodaci_list';
    const dosud = { od: { [K]: '2026-09-08' }, dorucene: {} };
    expect(posunKurzor(dosud, { agendas: [agendaOk] }, '2026-09-07', T, []).od[K]).toBe('2026-09-14');
    for (const vada of [{ unreachable: true }, { error: 'x' }, { windowCapped: true }, { odlozeno: 3 }]) {
      expect(posunKurzor(dosud, { agendas: [{ ...agendaOk, ...vada }] }, '2026-09-07', T, []).od[K], JSON.stringify(vada)).toBe('2026-09-08');
    }
  });

  it('⛔ selhaná agenda NEdrží kurzor jiné agendy (naměřeno 09-15: 3 agendy invalid_client/fetch failed)', () => {
    const dosud = { od: { 'rozbita/money.dodaci_list': '2026-09-10', 'zdrava/money.dodaci_list': '2026-09-13' }, dorucene: {} };
    const k = posunKurzor(dosud, { agendas: [
      { ...agendaOk, agenda: 'rozbita', error: 'svc-money 502: invalid_client' },
      { ...agendaOk, agenda: 'zdrava' },
    ] }, '2026-09-09', T, []);
    expect(k.od).toEqual({ 'rozbita/money.dodaci_list': '2026-09-10', 'zdrava/money.dodaci_list': '2026-09-14' });
  });

  it('stav starší verze (od jako jedno datum / null) se čte jako bez kurzoru dvojic', () => {
    const stary = { od: null, dorucene: { 'a/k/x': '2026-09-14' } } as unknown as Parameters<typeof posunKurzor>[0];
    expect(posunKurzor(stary, { agendas: [agendaOk] }, '2026-09-13', T, []).od).toEqual({ 'agenda-a/money.dodaci_list': '2026-09-14' });
  });

  it('doručené se přidají a zapomenou se jen doklady starší než okno', () => {
    const dosud = { od: {}, dorucene: { 'a/k/stary': '2026-09-01', 'a/k/v-okne': '2026-09-12' } };
    const k = posunKurzor(dosud, { agendas: [agendaOk] }, '2026-09-11', T, [{ klic: 'a/k/novy', datum: '2026-09-14' }]);
    expect(k.dorucene).toEqual({ 'a/k/v-okne': '2026-09-12', 'a/k/novy': '2026-09-14' });
  });
});

// ── ČÁST 3: hodinky — žádné opakované doručení, okno po výpadku, trigger ────────────────
const h = vi.hoisted(() => ({
  meta: {} as Record<string, unknown>,
  pullSince: [] as string[],
  uploady: [] as string[],
  rejstrik: [] as Array<{ id: string; datum: string }>,
  pullSelze: false,
  sinceZdrave: [] as string[],
  sinceRozbite: [] as string[],
  rozbitaSelze: false,
  configNavic: {} as Record<string, unknown>,
  agendyTahu: [] as string[][],
}));

vi.mock('pg', () => {
  class Client {
    async connect(): Promise<void> {}
    async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
      const t = sql.trim();
      if (t.includes('agent_knowledge_sources')) {
        return { rows: [{ is_active: true, config: { pull_interval_ms: 1_800_000, max_new_per_run: 200, since_days: 2, doc_markers: ['money.dodaci_list'], ...h.configNavic } }] };
      }
      if (t.startsWith('select')) {
        return { rows: [{ last_run_at: h.meta.money_last_run_at ?? null, last_result: null, ceka_na_export: null, kurzor: h.meta.money_kurzor ?? null }] };
      }
      if (t.includes("'money_kurzor'")) { h.meta.money_kurzor = JSON.parse(String(params[1])); return { rows: [] }; }
      if (t.includes("'money_last_run_at'")) { h.meta.money_last_run_at = new Date(Date.now()).toISOString(); return { rows: [] }; }
      return { rows: [] };
    }
    async end(): Promise<void> {}
  }
  return { Client };
});

vi.mock('../clients/money-driver.js', async (importOriginal) => {
  const skutecny = await importOriginal<typeof import('../clients/money-driver.js')>();
  return {
    ...skutecny,
    createMoneyClient: () => ({ listAgendas: async () => [{ key: 'agenda-a' }, { key: 'rozbita' }] }),
    // Rozdíl proti `known` dělá tady stejně jako skutečný driver — hodinky měří, CO mu předají.
    pullAll: async (_c: unknown, agendy: Array<{ key: string }>, _d: unknown,
      opts: { since: string; sinceFor?: (a: string, k: string) => string; known: ReadonlySet<string> }) => {
      h.pullSince.push(opts.since);
      h.agendyTahu.push(agendy.map((a) => a.key));
      if (h.pullSelze) throw new Error('svc-money: fetch failed');
      const sinceA = opts.sinceFor ? opts.sinceFor('agenda-a', 'money.dodaci_list') : opts.since;
      const sinceR = opts.sinceFor ? opts.sinceFor('rozbita', 'money.dodaci_list') : opts.since;
      h.sinceZdrave.push(sinceA); h.sinceRozbite.push(sinceR);
      const nove = h.rejstrik.filter((r) => r.datum >= sinceA && !opts.known.has(skutecny.klicDokladu('agenda-a', 'money.dodaci_list', r.id)));
      // Klíč kurzoru hlásí driver ve výsledku a lane podle něj kurzor posouvá.
      // Mock ho musí hlásit TAKY a TÝMŽ výpočtem — jinak by se tu mlčky testoval
      // fallback `klicDvojice`, zatímco produkce píše `#zmeny` (dodák se od
      // 2026-09-25 táhne po změnách). Kurzor by se pak posouval jinam, než se čte.
      // Druh se bere z PRODUKČNÍ deklarace (import až tady, po dokončení
      // modulového cyklu) — přepsaná kopie by se s ní rozešla a test by pak
      // hlídal svůj vlastní výmysl.
      const { DRUHY_DOKLADU } = await import('../clients/money-lane.js');
      const druhDodak = DRUHY_DOKLADU.find((d) => d.marker === 'money.dodaci_list')!;
      const klicA = skutecny.klicKurzoru('agenda-a', druhDodak);
      const klicR = skutecny.klicKurzoru('rozbita', druhDodak);
      const vysledky = [{
        agenda: 'agenda-a', kind: 'money.dodaci_list', kurzor: klicA,
        windowRows: h.rejstrik.length, windowCapped: false,
        fresh: nove.length, unreachable: false, odlozeno: 0, since: sinceA,
        documents: nove.map((r) => ({ name: `agenda-a-${r.id}.json`, body: '{}', id: r.id, datum: r.datum })),
      }, {
        agenda: 'rozbita', kind: 'money.dodaci_list', kurzor: klicR,
        windowRows: 0, windowCapped: false, fresh: 0, unreachable: false,
        odlozeno: 0, since: sinceR, documents: [], ...(h.rozbitaSelze ? { error: 'svc-money 502: invalid_client' } : {}),
      }];
      return vysledky.filter((r) => agendy.some((a) => a.key === r.agenda));
    },
  };
});

vi.mock('../clients/ingest-client.js', () => {
  class IngestError extends Error { constructor(public readonly kind: string, m: string) { super(m); } }
  class IngestClient {
    async upload(name: string): Promise<unknown> { h.uploady.push(name); return {}; }
    async export(): Promise<unknown> { return {}; }
    async progress(): Promise<unknown> { return { active: false }; }
    async runs(): Promise<unknown> { return { runs: [] }; }
  }
  return { IngestClient, IngestError };
});

import { createMoneyLane } from '../clients/money-lane.js';

const MIN = 60_000;
const config = { moneyApiUrl: 'http://svc-money', moneyApiToken: 'x', ingestApiUrl: 'http://ingest', ingestApiToken: 'x', postgresUrl: 'postgres://nikam' } as never;

describe('hodinky: novinky jednou, okno po výpadku, trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    Object.assign(h, { meta: {}, pullSince: [], uploady: [], rejstrik: [{ id: 'd1', datum: '2026-09-13' }, { id: 'd2', datum: '2026-09-14' }],
      pullSelze: false, sinceZdrave: [], sinceRozbite: [], rozbitaSelze: false, configNavic: {}, agendyTahu: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('doklad se do ingestu pošle JEDNOU, i když tahy běží dál', async () => {
    const lane = createMoneyLane(config, tichy);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);          // první tah
    await vi.advanceTimersByTimeAsync(31 * MIN);         // další tah po intervalu
    h.rejstrik.push({ id: 'd3', datum: '2026-09-14' });
    await vi.advanceTimersByTimeAsync(31 * MIN);         // třetí tah — jen novinka
    lane.stop();
    expect(h.pullSince.length).toBeGreaterThanOrEqual(3);
    expect(h.uploady).toEqual(['agenda-a-d1.json', 'agenda-a-d2.json', 'agenda-a-d3.json']);
  });

  it('po výpadku okno sahá ke kurzoru své dvojice, ne jen since_days od teď', async () => {
    // Klíč nese `#zmeny`: dodák se od 2026-09-25 táhne PO ZMĚNÁCH, takže jeho
    // kurzor je kurzorem změn. Kdyby se seedoval starý novinkový klíč, lane by
    // ho nenašla a spadla by na okno z politiky — tedy přesně to, co tenhle
    // test měří, že se STÁT NEMÁ.
    h.meta.money_kurzor = { od: { 'agenda-a/money.dodaci_list#zmeny': '2026-09-08' }, dorucene: {} };
    const lane = createMoneyLane(config, tichy);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    lane.stop();
    expect(h.sinceZdrave[0]).toBe('2026-09-07');
    expect((h.meta.money_kurzor as { od: Record<string, string> }).od['agenda-a/money.dodaci_list#zmeny']).toBe('2026-09-14');
  });

  it('selhávající agenda táhne od SVÉHO kurzoru a zdravá dál malým oknem; po zotavení dožene', async () => {
    h.meta.money_kurzor = { od: { 'agenda-a/money.dodaci_list#zmeny': '2026-09-14', 'rozbita/money.dodaci_list#zmeny': '2026-09-05' }, dorucene: {} };
    h.rozbitaSelze = true;
    const lane = createMoneyLane(config, tichy);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(h.sinceZdrave[0], 'zdravá agenda se nesmí dívat do minulosti kvůli cizí chybě').toBe('2026-09-12');
    expect(h.sinceRozbite[0]).toBe('2026-09-04');
    expect((h.meta.money_kurzor as { od: Record<string, string> }).od['rozbita/money.dodaci_list#zmeny'], 'chyba kurzor neposune').toBe('2026-09-05');
    h.rozbitaSelze = false;
    await vi.advanceTimersByTimeAsync(31 * MIN);
    lane.stop();
    expect(h.sinceRozbite[1], 'po zotavení táhne od místa výpadku').toBe('2026-09-04');
    expect((h.meta.money_kurzor as { od: Record<string, string> }).od['rozbita/money.dodaci_list#zmeny']).toBe('2026-09-14');
  });

  it('trigger spustí tah před koncem intervalu; víc triggerů splyne do jednoho tahu', async () => {
    const lane = createMoneyLane(config, tichy);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);          // tah č. 1, další až za 30 min
    expect(h.pullSince).toHaveLength(1);
    lane.pozadatTah('money DLP2602309');
    lane.pozadatTah('money DLP2602310');
    const st = await lane.status();
    expect(st.pozadano?.duvod).toBe('money DLP2602310');
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(h.pullSince, 'trigger má tah spustit do minuty').toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    lane.stop();
    expect(h.pullSince, 'dva triggery = jeden tah, žádný další bez nového požadavku').toHaveLength(2);
  });

  it('trigger neobejde odklad po selhání — zdroj se nebombarduje', async () => {
    h.pullSelze = true;
    const lane = createMoneyLane(config, tichy);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);          // selhání č. 1 → odklad 1 min
    await vi.advanceTimersByTimeAsync(1 * MIN);          // selhání č. 2 → odklad 2 min
    const pred = h.pullSince.length;
    lane.pozadatTah('trigger během odkladu');
    await vi.advanceTimersByTimeAsync(1 * MIN);          // odklad ještě běží
    expect(h.pullSince.length, 'během odkladu se na Money nesahá ani na požádání').toBe(pred);
    lane.stop();
  });
});

describe('vypnutá agenda (inactive_agendas) — rozhodnutí správce v konfiguraci zdroje', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    Object.assign(h, { meta: {}, pullSince: [], uploady: [], rejstrik: [{ id: 'd1', datum: '2026-09-14' }],
      pullSelze: false, sinceZdrave: [], sinceRozbite: [], rozbitaSelze: true, configNavic: {}, agendyTahu: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('vypnutá agenda se netáhne, zdravá ano; vynechání je vidět ve výsledku', async () => {
    h.configNavic = { inactive_agendas: ['rozbita'] };
    h.meta.money_kurzor = { od: { 'rozbita/money.dodaci_list#zmeny': '2026-09-05' }, dorucene: {} };
    const r = await createMoneyLane(config, tichy).runOnce();
    expect(h.agendyTahu[0]).toEqual(['agenda-a']);
    expect(r.vynechane).toEqual(['rozbita']);
    expect(r.agendas.map((a) => a.agenda)).toEqual(['agenda-a']);
    expect(h.uploady).toEqual(['agenda-a-d1.json']);
    expect((h.meta.money_kurzor as { od: Record<string, string> }).od['rozbita/money.dodaci_list#zmeny'],
      'kurzor vypnuté agendy zůstává — po zapnutí dožene').toBe('2026-09-05');
  });

  it('bez klíče se táhne všechno (nevyplněno = nic vypnuto)', async () => {
    const r = await createMoneyLane(config, tichy).runOnce();
    expect(h.agendyTahu[0]).toEqual(['agenda-a', 'rozbita']);
    expect(r.vynechane).toEqual([]);
  });

  it('neznámý klíč nic nevypne a ohlásí se', async () => {
    h.configNavic = { inactive_agendas: ['preklep'] };
    const warn = vi.fn();
    const r = await createMoneyLane(config, { ...(tichy as object), warn } as never).runOnce();
    expect(h.agendyTahu[0]).toEqual(['agenda-a', 'rozbita']);
    expect(r.neznameVypnute).toEqual(['preklep']);
    expect(warn).toHaveBeenCalled();
  });

  it('nesmyslná hodnota (ne pole řetězců) tah zastaví, nedosazuje „nic vypnuto"', async () => {
    h.configNavic = { inactive_agendas: 'rozbita' };
    const r = await createMoneyLane(config, tichy).runOnce();
    expect(h.agendyTahu).toEqual([]);
    expect(r.agendas).toEqual([]);
  });
});
