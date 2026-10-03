import { describe, expect, it } from 'vitest';

const bundle = {
  config: {
    instance_slug: 'test',
    api: { postgrest_url: 'http://x', token_exchange_url: 'http://x' },
    auth: { issuer: 'http://x', client_id: 'c' },
    i18n: { default_locale: 'en', locales: ['en'] },
    snapshot_public_jwk: null,
    preview: { enabled: false },
    workbench: {
      client_id: 'c',
      detail_blocks: ['wb_doc_detail'],
      detail_by_kind: { counterparty: { param: 'debtor', blocks: ['sm_debtor_invoices'] } }
    }
  },
  i18n: { en: {} }
};
(globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = bundle;
const { tableOpens } = await import('../src/components/blocks.js');
const { detailSlugs } = await import('../src/App.js');
const { fetchAllPages, ApiError } = await import('../src/api.js');

describe('proklik vede jen tam, kde je co otevřít', () => {
  // Naměřeno 2026-09-23: řádky druhů bez detail_by_kind (story_entry v poradě,
  // answer_run a ingest_source ve správě) byly klikací a klik skončil chybovou kartou.
  it('druh bez detailu v instanci není odkaz', () => {
    const canOpen = (k: string): boolean => detailSlugs(k).length > 0;
    expect(tableOpens('counterparty', true, canOpen)).toBe(true);
    expect(tableOpens('document', true, canOpen), 'document jede přes detail_blocks').toBe(true);
    expect(tableOpens('story_entry', true, canOpen)).toBe(false);
    expect(tableOpens('counterparty', false, canOpen), 'bez příjemce nic').toBe(false);
    expect(tableOpens('story_entry', true), 'bez canOpen = dřívější chování').toBe(true);
  });
});

describe('fetchAllPages — useknutá odpověď serveru se dočte celá', () => {
  const server = (total: number, cap: number) => {
    const calls: string[] = [];
    const page = async (query: string): Promise<unknown> => {
      calls.push(query);
      const offset = Number(/offset=(\d+)/.exec(query)?.[1] ?? 0);
      if (offset > 0 && offset >= total) throw new ApiError('range', 416);
      return Array.from({ length: Math.min(cap, total - offset) }, (_, i) => offset + i);
    };
    return { calls, page };
  };

  // Naměřeno 2026-09-23: překladů 1 860, PostgREST max-rows 1 000 → shell dostal 1 000.
  it('1 860 řádků za stropem 1 000 → všech 1 860, dvě žádosti', async () => {
    const s = server(1860, 1000);
    const rows = await fetchAllPages(s.page);
    expect(rows).toHaveLength(1860);
    expect(new Set(rows).size, 'žádný řádek dvakrát').toBe(1860);
    expect(s.calls).toEqual(['', 'offset=1000']);
  });

  it('přesný násobek stropu skončí 416 jako konec, ne jako chyba', async () => {
    const s = server(2000, 1000);
    expect(await fetchAllPages(s.page)).toHaveLength(2000);
    expect(s.calls).toEqual(['', 'offset=1000', 'offset=2000']);
  });

  it('server bez stropu: jedna plná stránka a konec', async () => {
    const s = server(300, 10_000);
    expect(await fetchAllPages(s.page)).toHaveLength(300);
  });

  it('chyba PRVNÍ stránky se neschová', async () => {
    const page = async (): Promise<unknown> => {
      throw new ApiError('boom', 500);
    };
    await expect(fetchAllPages(page)).rejects.toThrow('boom');
  });
});
