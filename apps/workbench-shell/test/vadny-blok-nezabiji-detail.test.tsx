/**
 * @vitest-environment jsdom
 *
 * Brána: v DETAILU záznamu nesmí jeden vadný blok shodit ostatní.
 *
 * ⛔ NAMĚŘENO 2026-09-07 na produkci. Detail dvojčete hlásil „Data se nepodařilo
 * načíst" u KAŽDÉHO záznamu — přestože všech pět volání vrátilo 200 s kompletními
 * daty. Padala až kontrakt-kontrola jednoho z nich (`<fork>_dvojce_vazby` nesl
 * boolean v buňce tabulky) a `Promise.all` z toho udělal pád všech pěti.
 *
 * Uživatel tedy viděl TOTÁLNÍ VÝPADEK tam, kde chyběl jeden řádek. To je drahé
 * dvakrát: jednou pro něj, podruhé pro diagnózu — hledá se výpadek backendu,
 * a přitom jde o jedno políčko.
 *
 * ⭐ TÁŽ ZÁSADA JAKO NA HRANICI MASKY — „neznámé nezabíjí známé"
 * (neznam-nezabiji-znam.test.ts, 2026-08-08). `loadConsole` ji drží od začátku:
 * vadný blok sesbírá do `failed` a zbytek ukáže. Detail ji NEMĚL a platilo v něm
 * všechno-nebo-nic. Tenhle test drží, aby se ty dvě hranice zase nerozešly.
 *
 * CO SE MĚŘÍ:
 *   1. jeden vadný blok → ostatní se vrátí a vadný je pojmenovaný v `failed`;
 *   2. VŠECHNY vadné → prázdný seznam (teprve to je chyba, ne dřív);
 *   3. nic vadného → nic v `failed` (měřidlo neplácá poplach nad zdravým stavem).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../src/auth.js', () => ({ getToken: async () => 'test-token' }));

const provenance = {
  source_slug: 'audience_admin_twin_directory_v',
  freshness_at: '2026-09-07T12:00:00Z',
  trace_id: 'tr-detail',
};

const DOBRY = 'blok_dobry';
const DOBRY2 = 'blok_dobry_2';
const VADNY = 'blok_vadny';

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (url.pathname === '/rpc/get_block_data') {
        const slug = String(body.p_block_slug);
        if (slug === VADNY) {
          // Odpověď je 200 a vypadá jako blok — porušuje ale kontrakt. Přesně
          // tenhle tvar vadu způsobil: síť i server v pořádku, padá validace.
          return send(200, { schema_version: 1, block_slug: slug, block_type: 'table' });
        }
        return send(200, {
          schema_version: 1,
          block_slug: slug,
          block_type: 'table',
          title_key: `app.blocks.${slug}.title`,
          sensitivity: 'restricted',
          provenance,
          data: { columns: [{ key: 'label', label_key: 'app.cols.twin_label' }], rows: [], row_kind: 'twin' },
        });
      }
      return send(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = {
    config: {
      instance_slug: 'detail-odolnost',
      api: { postgrest_url: base, token_exchange_url: base },
      auth: { issuer: base, client_id: 'c' },
      i18n: { default_locale: 'en', locales: ['en'] },
      snapshot_public_jwk: null,
      preview: { enabled: false },
      workbench: { detail_by_kind: { twin: { param: 'twin_id', blocks: [DOBRY, VADNY, DOBRY2] } } },
    },
    i18n: { en: {} },
  };
});
afterAll(() => server.close());
afterEach(() => vi.restoreAllMocks());

const ID = 'd97cf08f-33bb-4198-80ab-29116b39ddb2';

describe('detail záznamu — vadný blok nezabíjí ostatní', () => {
  it('jeden vadný blok: ostatní dorazí, vadný je pojmenovaný', async () => {
    const { loadDetailBlocks } = await import('../src/App.js');
    const { blocks, failed } = await loadDetailBlocks([DOBRY, VADNY, DOBRY2], 'twin_id', ID);
    expect(
      blocks.map((b) => b.block_slug),
      'jeden vadný blok shodil ostatní — uživatel vidí totální výpadek místo jednoho chybějícího rámu',
    ).toEqual([DOBRY, DOBRY2]);
    expect(failed, 'vadný blok musí být POJMENOVANÝ, jinak se diagnóza hledá naslepo').toEqual([VADNY]);
  });

  it('všechny vadné: prázdný seznam — teprve to je chyba', async () => {
    const { loadDetailBlocks } = await import('../src/App.js');
    const { blocks, failed } = await loadDetailBlocks([VADNY], 'twin_id', ID);
    expect(blocks).toEqual([]);
    expect(failed).toEqual([VADNY]);
  });

  it('nic vadného: `failed` zůstane prázdné (žádný falešný poplach)', async () => {
    const { loadDetailBlocks } = await import('../src/App.js');
    const { blocks, failed } = await loadDetailBlocks([DOBRY, DOBRY2], 'twin_id', ID);
    expect(blocks.map((b) => b.block_slug)).toEqual([DOBRY, DOBRY2]);
    expect(failed).toEqual([]);
  });
});
