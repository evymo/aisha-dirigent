import { describe, expect, it } from 'vitest';
import { validateBlock, validateBlockData, type TableBlock } from '../src/index.js';
import { makeKpi } from './fixtures.js';

/**
 * Původ jako ŘETĚZ, pokrytí jako „N z M", nahrazené verze jako HISTORIE.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-09-25 na kartě protistrany):
 *  - každý blok hlásil „ZDROJ: li-source-registry" — jméno tabulky, ne zdroj; nikdo
 *    nepoznal, že čísla jsou z ERP a jak stará (`chain`);
 *  - „Smluv 0" a „faktur 50" bez toho, kolik z nich je potvrzených / kolik je celek;
 *    o dva dny dřív useknutý seznam 50 z 97 dlužníků vypadal jako celek (`coverage`);
 *  - dvě verze téže faktury vedle sebe = dvojnásobný dluh po splatnosti; kontrakt
 *    neměl jak říct „tenhle řádek nahradila novější verze" (`superseded_key`).
 *
 * Kontrakt roste jen VOLITELNÝMI vlastnostmi: starý producent posílá totéž co dřív
 * a projde; nový klient čte navíc. Rozpor ve známé vlastnosti (n > m, ukazatel na
 * neexistující sloupec) je odmítnutí, ne degradace — blok by lhal.
 */
const provenance = {
  source_slug: 'li-source-registry',
  freshness_at: '2026-09-25T09:16:00Z',
  trace_id: 'counterparty-metric:receivable_open',
  chain: [
    { source_slug: 'money', at: '2026-09-25T08:53:34Z' },
    { source_slug: 'local-ingest', at: '2026-09-25T09:01:45Z' },
    { source_slug: 'li-source-registry' }
  ],
  coverage: { n: 49, m: 50, label_key: 'app.coverage.invoices' }
};

function table(over: Partial<TableBlock['data']> = {}): TableBlock {
  return {
    schema_version: 1,
    block_slug: 'sm_debtor_invoices',
    block_type: 'table',
    title_key: 'app.sm.blocks.debtor_invoices.title',
    sensitivity: 'internal',
    provenance,
    data: {
      columns: [
        { key: 'cislo', label_key: 'app.cols.invoice_number' },
        { key: 'zbyva', label_key: 'app.cols.amount_unpaid', align: 'right' },
        { key: 'stav', label_key: 'app.cols.state', value_keys: true },
        { key: 'nahrazeno', label_key: 'app.cols.superseded_by' },
        { key: 'verze', label_key: 'app.cols.version', align: 'right' }
      ],
      rows: [
        { cislo: 'F-0001', zbyva: '100.00', stav: 'app.inv.state.overdue', nahrazeno: 'doc-b', verze: 1 },
        { cislo: 'F-0001', zbyva: '0', stav: 'app.inv.state.paid', nahrazeno: null, verze: 2 }
      ],
      row_kind: 'document',
      superseded_key: 'nahrazeno',
      version_key: 'verze',
      ...over
    }
  };
}

describe('provenance: řetěz původu a pokrytí', () => {
  it('blok s chain + coverage projde přísně (žádná degradace)', () => {
    const r = validateBlock(makeKpi({ provenance }));
    expect(r.ok, r.errors.join('; ')).toBe(true);
    expect(r.degraded).toEqual([]);
  });

  it('starý producent bez chain/coverage projde beze změny (volitelné)', () => {
    const r = validateBlock(makeKpi());
    expect(r.ok).toBe(true);
  });

  it('skok řetězu s neznámým klíčem přísně neprojde, tolerantně se vykreslí a drift se vyjmenuje', () => {
    const r = validateBlock(makeKpi({ provenance: { ...provenance, chain: [{ source_slug: 'money', kdo: 'x' } as never] } }));
    expect(r.ok).toBe(true);
    expect(r.degraded).toEqual(['/provenance/chain/0/kdo']);
  });

  it('coverage n > m je odmítnutí, ne degradace (schéma to neumí, validate ano)', () => {
    const r = validateBlock(makeKpi({ provenance: { ...provenance, coverage: { n: 5, m: 3 } } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/n \(5\) > m \(3\)/);
  });

  it('coverage bez m neprojde — „N z ?" není pokrytí', () => {
    const r = validateBlock(makeKpi({ provenance: { ...provenance, coverage: { n: 5 } as never } }));
    expect(r.ok).toBe(false);
  });
});

describe('table: nahrazené verze jako historie', () => {
  it('superseded_key a version_key ukazující na existující sloupce projdou', () => {
    const r = validateBlock(table());
    expect(r.ok, r.errors.join('; ')).toBe(true);
    expect(r.degraded).toEqual([]);
    expect(validateBlockData(table().data)).toEqual({ ok: true, mask: 'table' });
  });

  it('ukazatel na sloupec, který v columns není, je odmítnutí', () => {
    const r = validateBlock(table({ superseded_key: 'neexistuje' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/superseded_key.*'neexistuje'/);
    const v = validateBlock(table({ version_key: 'chybi' }));
    expect(v.ok).toBe(false);
  });

  it('tabulka bez superseded_key/version_key projde jako dřív (volitelné)', () => {
    const d = table().data;
    delete d.superseded_key;
    delete d.version_key;
    expect(validateBlock(table(d)).ok).toBe(true);
  });

  it('negativní kontrola: bez kontraktu by producent musel nahrazenou verzi buď skrýt, nebo sčítat', () => {
    // Dva řádky téhož dokladu; jen kontrakt říká, který je historie. Součet „zbyva"
    // přes všechny řádky = 100, přes řádky bez nástupce = 0 — to je ten rozdíl.
    const d = table().data;
    const vse = d.rows.reduce((s, r) => s + Number(r.zbyva), 0);
    const platne = d.rows.filter((r) => r[d.superseded_key!] == null).reduce((s, r) => s + Number(r.zbyva), 0);
    expect([vse, platne]).toEqual([100, 0]);
  });
});
