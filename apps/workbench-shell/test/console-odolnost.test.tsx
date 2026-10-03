/**
 * @vitest-environment jsdom
 *
 * (jsdom kvůli SDK: `extranet-sdk-ui/mc.js` se registruje na `window` už při
 * importu, a App.tsx si SDK tahá přes sdk.ts. Test sám DOM nepotřebuje.)
 *
 * Brána: jeden rozbitý blok nesmí zhasnout celou konzoli
 *
 * `loadConsole` ten slib nese v komentáři od začátku — „one block whose data
 * source is broken (bad RPC shape, contract violation, RLS denial) must NOT
 * blank the whole console". Slib, který nikdo neměří, ale přestane platit tichou
 * úpravou: stačí, aby někdo `Promise.all` nechal bez per-blokového `catch`, a
 * jediná vadná odpověď shodí sekci celou.
 *
 * NENÍ TO TEORIE. Měřeno 2026-08-01 na tehdejším mobilním (řidičském) povrchu:
 * tatáž cesta tam per-blokovou pojistku NEMĚLA, čtyři ze sedmi bloků porady byly
 * nad jeho capem citlivosti, `Promise.all` odmítl celý balík — a uživatel dostal
 * prázdnou obrazovku místo tří bloků, které měl vidět. Ten povrch byl mezitím
 * odstraněn (`bb09c4c2`, třetí renderer, který se nikde nenasazoval), takže dnes
 * tu vadu nikde neuvidíš; zůstává ale poučení, že rozdíl mezi „konzole přežije"
 * a „konzole zhasne" je jeden `catch` a nikdo ho nehlídal. Tenhle test ho hlídá.
 *
 * ⚠️ CO TENHLE TEST NEHLÍDÁ (a co ho nemá nahradit): že se selhání uživateli
 * UKÁŽE. Dnes zmizí — blok se odfiltruje a sekce napíše totéž „Zatím není co
 * zobrazit." jako u legitimního prázdna (nález Z6-N1). Rozlišit prázdno od
 * chyby znamená vykreslit u každého vadného bloku chybovou kartu, a s dnešním
 * dluhem kontraktu by jich uživatel uviděl patnáct najednou. Pořadí je proto
 * dané: nejdřív kontrakt bloků, teprve pak viditelné selhání. Do té doby tenhle
 * test drží aspoň to, že ostatní bloky přežijí a že selhání JDE diagnostikovat.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SurfaceBlock } from '@aisha/surface-blocks';

vi.mock('../src/auth.js', () => ({ getToken: async () => 'test-token' }));

const provenance = {
  source_slug: 'local-ingest',
  freshness_at: '2026-08-01T06:00:00Z',
  trace_id: 'tr-odolnost',
};

/** Platný blok — tvar bere ze schématu, ne z domněnky. */
const zdravyBlok = (slug: string): SurfaceBlock =>
  ({
    schema_version: 1,
    block_slug: slug,
    block_type: 'kpi_tile',
    title_key: `app.blocks.${slug}.title`,
    sensitivity: 'internal',
    provenance,
    data: { value: 42 },
  }) as SurfaceBlock;

/** Sekce se třemi bloky; prostřední je rozbitý — jako na produkci. */
const ROZBITY = 'blok_rozbity';
const ZDRAVE = ['blok_prvni', 'blok_treti'];

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
      const body = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      if (url.pathname === '/rpc/get_surface_layout') {
        return send(200, {
          schema_version: 1,
          surface: body.p_surface,
          blocks: [
            { block_slug: ZDRAVE[0], block_type: 'kpi_tile', title_key: 'a', position: 0 },
            { block_slug: ROZBITY, block_type: 'kpi_tile', title_key: 'b', position: 1 },
            { block_slug: ZDRAVE[1], block_type: 'kpi_tile', title_key: 'c', position: 2 },
          ],
        });
      }
      if (url.pathname === '/rpc/get_block_data') {
        const slug = body.p_block_slug;
        // Rozbití je KONTRAKTNÍ, ne síťové: RPC odpoví 200 a tvarem, který maska
        // nepřijme — přesně tak vypadá dnešních 15 zahozených bloků na produkci.
        if (slug === ROZBITY) return send(200, { data: { rows: [] }, provenance });
        return send(200, zdravyBlok(String(slug)));
      }
      return send(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  (globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = {
    config: {
      instance_slug: 'odolnost',
      api: { postgrest_url: base, token_exchange_url: base },
      auth: { issuer: base, client_id: 'c' },
      i18n: { default_locale: 'en', locales: ['en'] },
      snapshot_public_jwk: null,
      preview: { enabled: false },
      workbench: { detail_blocks: [] },
    },
    i18n: { en: {} },
  };
});

afterAll(() => server.close());
afterEach(() => vi.restoreAllMocks());

describe('jeden rozbitý blok nezhasne celou konzoli', () => {
  it('ostatní bloky se načtou a vadný se do výsledku nedostane', async () => {
    const { loadConsole } = await import('../src/App.js');
    const { blocks, failed } = await loadConsole('sekce_pod_testem');

    // Měřidlo má co měřit: kdyby layout nevrátil nic, prošlo by i rozbité chování.
    expect(blocks.length, 'layout nevydal ani jeden blok — test by měřil prázdno').toBeGreaterThan(0);

    const slugy = blocks.map((b) => b.block_slug);
    expect(slugy).toEqual(expect.arrayContaining(ZDRAVE));
    expect(slugy).not.toContain(ROZBITY);

    // ⭐ A ZÁROVEŇ se o něm MLUVÍ. Odolnost bez tohohle znamená, že blok jen
    // zmizí — a nepřítomnost nikdo nereklamuje: naměřeno 2026-08-08, šest bloků
    // takhle na produkci chybělo, aniž by to kdo poznal.
    expect(
      failed,
      'blok se nevykreslil a konzole to nikam neřekla — tiché prázdno je vada, ne odolnost',
    ).toContain(ROZBITY);
  });

  it('selhání jde diagnostikovat: hlásí se se slugem bloku', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loadConsole } = await import('../src/App.js');
    await loadConsole('sekce_pod_testem');

    const zminky = warn.mock.calls.map((c) => c.map(String).join(' '));
    expect(
      zminky.some((m) => m.includes(ROZBITY)),
      `selhání bloku se nikde neohlásilo — bez slugu v logu není podle čeho pátrat.\n` +
        `Zachyceno: ${JSON.stringify(zminky)}`,
    ).toBe(true);
  });
});
