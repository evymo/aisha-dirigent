/**
 * Money lane: přijetí dokladů je oddělené od jejich zpracování.
 *
 * ⛔ NAMĚŘENO 2026-09-13 v produkci instance. Tah po nahrání volal `ingest.run` a hned
 * `ingest.export`. Plný běh ingestu trval ~9 hodin a `POST /api/run` čekal na zámek;
 * tahu po 120 s vypršel čas, ale na serveru zůstalo vlákno, které později spustilo celý
 * běh. Tah to za pár minut zkusil znovu. Ingest pak dojížděl stovky fantomových běhů
 * (runs_history s `manual` ještě dva dny poté, co broker přestal volat).
 *
 * ⭐ CO SE MĚŘÍ:
 * - po nahrání se `run` NEVOLÁ — zpracování obstará hlídač ingestu
 * - export přijde až po doběhnutí běhu, který doklady skutečně obsahuje
 * - rozhodují HODINY INGESTU (čas doběhnutí běhu podle ingestu), ne hodiny brokeru
 * - probíhal-li při nahrání běh, čeká se na DVA doběhnuté — v pochybnostech později,
 *   nikdy bez vlastních dokladů
 * - 409 z exportu je „příště", ne selhání; jiná chyba exportu padá do odkladu
 * - export se dokončuje bez jediného dotazu na Money
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  meta: {} as Record<string, unknown>,
  dokladu: 2,
  dotazyMoney: 0,
  uploady: 0,
  runy: 0,
  exporty: 0,
  aktivni: false,
  behy: [] as { ts: string }[],
  exportChyba: null as null | { kind: string; zprava: string },
  chybaDvojice: null as null | string,
}));

vi.mock('pg', () => {
  class Client {
    async connect(): Promise<void> {}
    async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
      const t = sql.trim();
      if (t.includes('agent_knowledge_sources')) {
        return {
          rows: [{
            is_active: true,
            config: { pull_interval_ms: 3_600_000, max_new_per_run: 200, since_days: 2, doc_markers: ['money.dodaci_list'] },
          }],
        };
      }
      if (t.startsWith('select') && t.includes('money_ceka_na_export')) {
        return {
          rows: [{
            last_run_at: h.meta.money_last_run_at ?? null,
            last_result: h.meta.money_last_result ?? null,
            ceka_na_export: h.meta.money_ceka_na_export ?? null,
            kurzor: h.meta.money_kurzor ?? null,
          }],
        };
      }
      if (t.startsWith('insert') && t.includes("'money_last_run_at'")) {
        h.meta.money_last_run_at = new Date(Date.now()).toISOString();
        h.meta.money_last_result = JSON.parse(String(params[1]));
        return { rows: [] };
      }
      if (t.startsWith('insert') && t.includes("'money_kurzor'")) {
        h.meta.money_kurzor = JSON.parse(String(params[1]));
        return { rows: [] };
      }
      if (t.startsWith('insert') && t.includes("'money_ceka_na_export'")) {
        h.meta.money_ceka_na_export = JSON.parse(String(params[1]));
        return { rows: [] };
      }
      if (t.startsWith('update') && t.includes("- 'money_ceka_na_export'")) {
        delete h.meta.money_ceka_na_export;
        return { rows: [] };
      }
      throw new Error(`nepodvržený dotaz: ${t.slice(0, 60)}`);
    }
    async end(): Promise<void> {}
  }
  return { Client };
});

vi.mock('../clients/money-driver.js', async (importOriginal) => ({
  // skutečné čisté funkce (klíče dokladů a dvojic); podvržený je jen klient a tah
  ...(await importOriginal<typeof import('../clients/money-driver.js')>()),
  createMoneyClient: () => ({
    listAgendas: async () => {
      h.dotazyMoney += 1;
      return [{ key: 'agenda-a', label: 'Agenda A' }];
    },
  }),
  pullAll: async () => [{
    agenda: 'agenda-a', kind: 'money.dodaci_list',
    documents: h.chybaDvojice ? [] : Array.from({ length: h.dokladu }, (_, i) => ({ name: `DL${i}.json`, body: '{}' })),
    windowRows: h.chybaDvojice ? 0 : 10, fresh: h.chybaDvojice ? 0 : h.dokladu, unreachable: false, windowCapped: false,
    ...(h.chybaDvojice ? { error: h.chybaDvojice } : {}),
  }],
}));

vi.mock('../clients/ingest-client.js', () => {
  class IngestError extends Error {
    constructor(public readonly kind: string, message: string) { super(`INGEST_${kind.toUpperCase()}: ${message}`); }
  }
  class IngestClient {
    async upload(): Promise<unknown> { h.uploady += 1; return {}; }
    async run(): Promise<unknown> { h.runy += 1; return {}; }
    async export(): Promise<unknown> {
      if (h.exportChyba) throw new IngestError(h.exportChyba.kind, h.exportChyba.zprava);
      h.exporty += 1;
      return {};
    }
    async progress(): Promise<unknown> { return { active: h.aktivni, started_at: null }; }
    // Ingest vrací nejnovější běh první.
    async runs(): Promise<unknown> { return { runs: [...h.behy].reverse() }; }
  }
  return { IngestClient, IngestError };
});

import { createMoneyLane, smiExportovat, type CekaNaExport } from '../clients/money-lane.js';

const MIN = 60_000;
const START = Date.parse('2026-09-14T06:00:00Z');
const iso = (msOdStartu: number): string => new Date(START + msOdStartu).toISOString();

const config = {
  moneyApiUrl: 'http://svc-money:3016', moneyApiToken: 'x',
  ingestApiUrl: 'http://svc-local-ingest:8765', ingestApiToken: 'x',
  postgresUrl: 'postgres://nikam',
} as never;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

describe('smiExportovat — rozhodují hodiny ingestu', () => {
  const ceka = (o: Partial<CekaNaExport> = {}): CekaNaExport => ({
    od: iso(0), pocet: 2, posledniBehPred: iso(-60 * MIN), aktivniPriNahrani: false, ...o,
  });

  it('ingest při nahrání nezpracovával: stačí jeden doběhnutý běh po hranici', () => {
    expect(smiExportovat(ceka(), false, [{ ts: iso(5 * MIN) }]).smi).toBe(true);
  });

  it('dokud ingest zpracovává, neexportuje se', () => {
    expect(smiExportovat(ceka(), true, [{ ts: iso(5 * MIN) }]).smi).toBe(false);
  });

  it('ingest při nahrání zpracovával: jeden běh nestačí, čeká se na druhý', () => {
    const c = ceka({ aktivniPriNahrani: true });
    expect(smiExportovat(c, false, [{ ts: iso(5 * MIN) }]).smi).toBe(false);
    expect(smiExportovat(c, false, [{ ts: iso(6 * MIN) }, { ts: iso(5 * MIN) }]).smi).toBe(true);
  });

  it('běh doběhnutý přesně na hranici ani nečitelný čas se nezapočítá', () => {
    expect(smiExportovat(ceka(), false, [{ ts: iso(-60 * MIN) }]).dobehlo).toBe(0);
    expect(smiExportovat(ceka(), false, [{ ts: 'včera' }]).dobehlo).toBe(0);
  });

  it('bez předchozího běhu se počítá každý doběhnutý', () => {
    expect(smiExportovat(ceka({ posledniBehPred: null }), false, [{ ts: iso(1 * MIN) }]).smi).toBe(true);
  });
});

describe('hodinky money lane: přijmout, nechat zpracovat, pak exportovat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    Object.assign(h, {
      meta: {}, dokladu: 2, dotazyMoney: 0, uploady: 0, runy: 0, exporty: 0,
      aktivni: false, behy: [], exportChyba: null, chybaDvojice: null,
    });
    vi.mocked((logger as unknown as { error: ReturnType<typeof vi.fn> }).error).mockClear();
    vi.mocked((logger as unknown as { info: ReturnType<typeof vi.fn> }).info).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('po nahrání se run NEVOLÁ a vznikne viditelný záznam „čeká na export"', async () => {
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(3 * MIN);
    const st = await lane.status();
    lane.stop();

    expect(h.uploady).toBe(2);
    expect(h.runy, 'tah nesmí volat /api/run — zpracování je práce hlídače ingestu').toBe(0);
    expect(h.exporty, 'bez doběhnutého běhu se exportovat nesmí').toBe(0);
    expect(st.cekaNaExport).toMatchObject({ pocet: 2, posledniBehPred: null, aktivniPriNahrani: false });
  });

  it('export až po doběhnutí běhu — a bez jediného dalšího dotazu na Money', async () => {
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);          // tah: nahrání
    h.aktivni = true;                                    // hlídač si vstupu všiml
    await vi.advanceTimersByTimeAsync(20 * MIN);
    expect(h.exporty, 'během zpracování se neexportuje').toBe(0);

    h.aktivni = false;                                   // běh doběhl
    h.behy.push({ ts: iso(21 * MIN) });
    await vi.advanceTimersByTimeAsync(2 * MIN);
    lane.stop();

    expect(h.exporty).toBe(1);
    expect(h.meta.money_ceka_na_export, 'po exportu nic nečeká').toBeUndefined();
    expect(h.dotazyMoney, 'export se dokončuje bez dotazu na Money').toBe(1);
    expect(h.runy).toBe(0);
  });

  it('probíhal-li při nahrání běh, exportuje se až po DRUHÉM doběhnutém', async () => {
    h.aktivni = true;
    h.behy.push({ ts: iso(-3 * 60 * MIN) });             // starší běh, doběhl dávno
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);          // nahrání během probíhajícího běhu

    h.aktivni = false;                                   // doběhl běh, který vzal vstup PŘED nahráním
    h.behy.push({ ts: iso(10 * MIN) });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(h.exporty, 'první doběhnutý běh doklady obsahovat nemusí').toBe(0);

    h.behy.push({ ts: iso(30 * MIN) });                  // další běh, začal až po nahrání
    await vi.advanceTimersByTimeAsync(10 * MIN);
    lane.stop();

    expect(h.exporty).toBe(1);
  });

  it('409 z exportu není selhání: odklad neroste, zkusí se znovu', async () => {
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    h.behy.push({ ts: iso(2 * MIN) });
    h.exportChyba = { kind: 'busy', zprava: 'běh už probíhá' };
    await vi.advanceTimersByTimeAsync(3 * MIN);
    const st = await lane.status();
    expect(st.odklad.selhaniPoSobe, '409 nesmí spustit odklad').toBe(0);
    expect(st.cekaNaExport, 'po 409 se na export dál čeká').not.toBeNull();

    h.exportChyba = null;
    await vi.advanceTimersByTimeAsync(1 * MIN);
    lane.stop();
    expect(h.exporty).toBe(1);
  });

  it('jiná chyba exportu (ověření selhalo) padá do odkladu — ingest se nebombarduje', async () => {
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    h.behy.push({ ts: iso(2 * MIN) });
    h.exportChyba = { kind: 'server', zprava: '422 export odmítnut: verify selhal' };
    await vi.advanceTimersByTimeAsync(2 * MIN);
    const st = await lane.status();
    lane.stop();
    expect(st.odklad.selhaniPoSobe).toBeGreaterThanOrEqual(1);
    expect(h.exporty).toBe(0);
  });

  it('další nahrání během čekání sečte počet a posune hranici na novější běh', async () => {
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);          // první nahrání (2 doklady)
    h.aktivni = true;                                    // hlídač zpracovává — export čeká
    h.dokladu = 3;
    await vi.advanceTimersByTimeAsync(60 * MIN);         // uplynul interval → druhé nahrání
    lane.stop();

    expect(h.uploady).toBe(5);
    expect(h.meta.money_ceka_na_export).toMatchObject({ pocet: 5, aktivniPriNahrani: true });
  });

  it('selhaná dvojice se ohlásí jako SELHÁNÍ, ne jako „žádný nový doklad" (2026-09-24: 11/12 dvojic tiše)', async () => {
    h.chybaDvojice = 'svc-money 500: {"error":"vnitřní chyba"}';
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    lane.stop();

    const err = vi.mocked((logger as unknown as { error: ReturnType<typeof vi.fn> }).error);
    const info = vi.mocked((logger as unknown as { info: ReturnType<typeof vi.fn> }).info);
    const selhani = err.mock.calls.find((c) => String(c[1]).includes('tah SELHAL'));
    expect(selhani, 'chyba dvojice musí do logu jako error').toBeDefined();
    expect(selhani![0]).toMatchObject({ selhalo: 1, z: 1, chyby: [{ dvojice: 'agenda-a/money.dodaci_list' }] });
    expect(info.mock.calls.some((c) => String(c[1]).startsWith('money-lane: žádný nový doklad')),
      'při selhání se NESMÍ hlásit „žádný nový doklad"').toBe(false);
    expect(h.uploady).toBe(0);
    const kurzor = h.meta.money_kurzor as { od?: Record<string, string> } | undefined;
    expect(kurzor?.od?.['agenda-a/money.dodaci_list'], 'selhaná dvojice kurzor neposouvá').toBeUndefined();
  });
});
