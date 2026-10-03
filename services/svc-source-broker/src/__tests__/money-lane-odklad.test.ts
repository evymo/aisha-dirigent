/**
 * Money lane: selhávající tah nesmí bombardovat cizí systém.
 *
 * ⛔ NAMĚŘENO 2026-09-13 v RIQ. `runAndRecord` zapisuje `lastRunAt` až po
 * úspěšném běhu, takže hodinky selhaný tah zkoušely při KAŽDÉM tiku (60 s):
 *   09-09  timeout doručení do ingestu   480 tahů za den (tik 60 s + upload 120 s)
 *   09-12  výpadek databáze            1 440 pokusů za den
 * Při timeoutu každý tah nejdřív celý prošel Money přes VPN, protože pád přišel
 * až u doručení. Zdravá lane s hodinovým intervalem přitom táhne 24× denně.
 *
 * ⭐ MĚŘÍ SE NA SKUTEČNÝCH HODINKÁCH, ne jen na čisté funkci. Podvržený je čas
 * a sousedé (databáze, Money, ingest). Čistá funkce `odkladPoSelhani` by prošla
 * i v kódu, kde kontrola odkladu stojí až ZA připojením — proto se tu počítají
 * skutečná připojení k databázi a skutečné dotazy na Money za den výpadku.
 *
 * ⭐ DRUHÁ POLOVINA VLASTNOSTI JE STEJNĚ DŮLEŽITÁ: odklad nesmí lane zpomalit.
 * První opakování je za minutu (jako dřív) a mezera mezi pokusy nikdy
 * nepřesáhne interval z politiky — selhávající lane nečeká déle než zdravá.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  dbDole: false,
  uploadSelze: 0,
  uploadVolani: 0,
  lastRunAt: null as string | null,
  pripojeni: [] as number[],
  dotazyMoney: [] as number[],
}));

vi.mock('pg', () => {
  class Client {
    async connect(): Promise<void> {
      h.pripojeni.push(Date.now());
      if (h.dbDole) throw new Error('getaddrinfo ENOTFOUND <fork>-db');
    }
    async query(sql: string): Promise<{ rows: unknown[] }> {
      if (sql.includes('agent_knowledge_sources')) {
        return {
          rows: [{
            is_active: true,
            config: { pull_interval_ms: 3_600_000, max_new_per_run: 50, since_days: 3, doc_markers: ['money.dodaci_list'] },
          }],
        };
      }
      if (sql.trim().startsWith('select') && sql.includes('money_last_run_at')) {
        return { rows: h.lastRunAt ? [{ last_run_at: h.lastRunAt, last_result: null }] : [] };
      }
      if (sql.includes('insert into public.audience_broker_sync_state')) {
        h.lastRunAt = new Date(Date.now()).toISOString();
      }
      return { rows: [] };
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
      h.dotazyMoney.push(Date.now());
      return [{ key: 'slezske-kamenolomy', label: 'Slezské kamenolomy' }];
    },
  }),
  pullAll: async () => [{
    agenda: 'slezske-kamenolomy', kind: 'money.dodaci_list',
    documents: [{ name: 'DL00001.json', body: '{}' }],
    windowRows: 10, fresh: 1, unreachable: false, windowCapped: false,
  }],
}));

vi.mock('../clients/ingest-client.js', () => ({
  IngestError: class extends Error {
    constructor(public readonly kind: string, message: string) { super(message); }
  },
  IngestClient: class {
    async upload(): Promise<unknown> {
      h.uploadVolani += 1;
      if (h.uploadVolani <= h.uploadSelze) {
        throw new Error('INGEST_TRANSPORT: The operation was aborted due to timeout');
      }
      return {};
    }
    async run(): Promise<unknown> { return {}; }
    async export(): Promise<unknown> { return {}; }
    // Po oddělení přijetí od zpracování čte tah po nahrání stav ingestu.
    async progress(): Promise<unknown> { return { active: false }; }
    async runs(): Promise<unknown> { return { runs: [] }; }
  },
}));

import { createMoneyLane, odkladPoSelhani } from '../clients/money-lane.js';

const MIN = 60_000;
const HODINA = 60 * MIN;
const DEN = 24 * HODINA;
const START = Date.parse('2026-09-13T00:00:00Z');

const config = {
  moneyApiUrl: 'http://svc-money:3016', moneyApiToken: 'x',
  ingestApiUrl: 'http://svc-local-ingest:8765', ingestApiToken: 'x',
  postgresUrl: 'postgres://nikam',
} as never;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const minuty = (casy: number[]): number[] => casy.map((t) => (t - START) / MIN);
const mezery = (casy: number[]): number[] => casy.slice(1).map((t, i) => t - casy[i]);

describe('odkladPoSelhani — čistá funkce', () => {
  it('bez selhání nečeká', () => {
    expect(odkladPoSelhani(0, HODINA)).toBe(0);
  });

  it('zdvojnásobuje od jedné minuty', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => odkladPoSelhani(n, HODINA))).toEqual([1, 2, 4, 8, 16, 32].map((m) => m * MIN));
  });

  it('nikdy nepřesáhne interval z politiky — ani po stovkách selhání', () => {
    for (let n = 1; n <= 500; n += 1) expect(odkladPoSelhani(n, HODINA)).toBeLessThanOrEqual(HODINA);
    expect(odkladPoSelhani(7, HODINA)).toBe(HODINA);
  });

  it('kratší interval z politiky je i kratší strop', () => {
    expect(odkladPoSelhani(10, 5 * MIN)).toBe(5 * MIN);
  });
});

describe('hodinky money lane při výpadku', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    Object.assign(h, { dbDole: false, uploadSelze: 0, uploadVolani: 0, lastRunAt: null, pripojeni: [], dotazyMoney: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('trvalý timeout ingestu: Money dostane za den nejvýš ~30 dotazů (bez odkladu 1 440)', async () => {
    h.uploadSelze = Number.POSITIVE_INFINITY;
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(DEN);
    lane.stop();

    expect(h.dotazyMoney.length, `dotazů na Money za den: ${h.dotazyMoney.length}`).toBeLessThanOrEqual(30);
    const m = mezery(h.dotazyMoney);
    expect(m[0], 'první opakování má přijít za minutu — krátký výpadek se nesmí zpomalit').toBe(MIN);
    expect(Math.max(...m), 'selhávající lane nesmí čekat déle než zdravá (interval z politiky)').toBeLessThanOrEqual(HODINA);
  });

  it('trvalý výpadek databáze: hodinky se nepřipojují každou minutu (bez odkladu 1 440×)', async () => {
    h.dbDole = true;
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(DEN);
    lane.stop();

    // Tohle chytí i vadu, kdy by kontrola odkladu stála až ZA připojením.
    expect(h.pripojeni.length, `připojení za den: ${h.pripojeni.length}`).toBeLessThanOrEqual(30);
    expect(Math.max(...mezery(h.pripojeni))).toBeLessThanOrEqual(HODINA);
    expect(h.dotazyMoney.length, 'bez databáze se na Money nesahá vůbec').toBe(0);
  });

  it('úspěch odklad vynuluje — další výpadek se zkouší zase za minutu', async () => {
    h.uploadSelze = 3;
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(10 * MIN);
    h.uploadSelze = Number.POSITIVE_INFINITY;
    await vi.advanceTimersByTimeAsync(60 * MIN);
    lane.stop();

    // 3 selhání (1, 2, 4), úspěch v 8. minutě, pak hodinový interval (68)
    // a nové selhání se zkouší znovu po minutě (69), ne po osmi.
    expect(minuty(h.dotazyMoney)).toEqual([1, 2, 4, 8, 68, 69]);
  });

  it('ruční tah z administrace odklad nečeká — ťuká člověk', async () => {
    h.uploadSelze = Number.POSITIVE_INFINITY;
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    const pred = h.dotazyMoney.length;
    await expect(lane.runOnce()).rejects.toThrow(/INGEST_TRANSPORT/);
    lane.stop();
    expect(h.dotazyMoney.length).toBe(pred + 1);
  });

  it('administrace odklad vidí a „kdy příště" ho zahrnuje', async () => {
    h.uploadSelze = Number.POSITIVE_INFINITY;
    const lane = createMoneyLane(config, logger);
    lane.start();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    const st = await lane.status();
    lane.stop();

    // Selhání v 1., 2. a 4. minutě → další pokus nejdřív v 8. → v 5. minutě zbývají 3.
    expect(st.odklad).toEqual({ selhaniPoSobe: 3, zbyvaMs: 3 * MIN });
    expect(st.dueInMs).toBe(3 * MIN);
  });
});
