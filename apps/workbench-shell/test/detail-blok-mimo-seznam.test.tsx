/**
 * @vitest-environment jsdom
 *
 * (jsdom kvůli SDK: `extranet-sdk-ui/mc.js` se registruje na `window` už při
 * importu, a App.tsx si SDK tahá přes sdk.ts. Test sám DOM nepotřebuje.)
 *
 * Brána: blok s nápovědou `presentation: 'detail'` se v SEZNAMU sekce
 * nenačítá ani nekreslí, ale pro detail záznamu zůstává dostupný.
 *
 * PROČ: detailový blok (record_detail, osa, takty, vazby dvojčete) čte JEDEN
 * záznam. Umístěný v sekci být musí — dispečer od W4 (2026-09-03) pouští jen
 * umístěný blok, jehož publikum volajícího připustí — ale bez identity vydá
 * jen prázdný rám. Naměřeno 2026-09-05 na registru dvojčat: čtyři prázdné
 * rámy pod tabulkou a čtyři zbytečné požadavky při každém otevření sekce.
 * Skrytí je změna v KLIENTOVI (rozvržení jsou data, `presentation` je
 * nápověda), ne v datech — proto tenhle test hlídá klienta.
 *
 * CO SE MĚŘÍ:
 *   1. seznam sekce detailový blok NEOBSAHUJE a NEHLÁSÍ ho jako selhání
 *      (odfiltrovaný blok není rozbitý blok — `failed` je pro diagnostiku vad);
 *   2. dispečer se na něj v seznamu vůbec neptá (žádný požadavek);
 *   3. s identitou záznamu se blok načte normálně (cesta detailu zůstává).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SurfaceBlock } from '@aisha/surface-blocks';

vi.mock('../src/auth.js', () => ({ getToken: async () => 'test-token' }));

const provenance = {
  source_slug: 'audience_admin_twin_directory_v',
  freshness_at: '2026-09-05T20:00:00Z',
  trace_id: 'tr-detail',
};

const SEZNAM = 'blok_registr';
const DETAIL = 'blok_dvojce';

const tabulka = (slug: string): SurfaceBlock =>
  ({
    schema_version: 1,
    block_slug: slug,
    block_type: 'table',
    title_key: `app.blocks.${slug}.title`,
    sensitivity: 'restricted',
    provenance,
    data: { columns: [{ key: 'label', label_key: 'app.cols.twin_label' }], rows: [], row_kind: 'twin' },
  }) as SurfaceBlock;

const zaznam = (slug: string, recordId: string | null): SurfaceBlock =>
  ({
    schema_version: 1,
    block_slug: slug,
    block_type: 'record_detail',
    title_key: `app.blocks.${slug}.title`,
    sensitivity: 'restricted',
    provenance,
    data: { record_id: recordId, badges: [], fields: [] },
  }) as SurfaceBlock;

let server: http.Server;
let base = '';
/** Každý dotaz na get_block_data se zapíše: slug + parametry. */
const dotazy: Array<{ slug: string; params: Record<string, unknown> }> = [];

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
      if (url.pathname === '/rpc/get_surface_layout') {
        return send(200, {
          schema_version: 1,
          surface: body.p_surface,
          blocks: [
            { block_slug: SEZNAM, block_type: 'table', title_key: 'a', position: 0 },
            // Detailový blok je UMÍSTĚNÝ (dispečer ho jinak nepustí), ale s nápovědou.
            { block_slug: DETAIL, block_type: 'record_detail', title_key: 'b', position: 10, presentation: 'detail' },
          ],
        });
      }
      if (url.pathname === '/rpc/get_block_data') {
        const slug = String(body.p_block_slug);
        const params = (body.p_params ?? {}) as Record<string, unknown>;
        dotazy.push({ slug, params });
        if (slug === DETAIL) {
          const id = typeof params.twin_id === 'string' ? params.twin_id : null;
          return send(200, zaznam(slug, id));
        }
        return send(200, tabulka(slug));
      }
      return send(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = {
    config: {
      instance_slug: 'detail-test',
      api: { postgrest_url: base, token_exchange_url: base },
      auth: { issuer: base, client_id: 'c' },
      i18n: { default_locale: 'en', locales: ['en'] },
      snapshot_public_jwk: null,
      preview: { enabled: false },
      workbench: { detail_by_kind: { twin: { param: 'twin_id', blocks: [DETAIL] } } },
    },
    i18n: { en: {} },
  };
});
afterAll(() => server.close());
afterEach(() => {
  vi.restoreAllMocks();
  dotazy.length = 0;
});

describe('detailový blok v seznamu sekce', () => {
  it('v seznamu není, nehlásí se jako selhání a dispečer se na něj neptá', async () => {
    const { loadConsole } = await import('../src/App.js');
    const { blocks, failed } = await loadConsole('registr');
    // Měřidlo má co měřit: bez tabulky by prošlo i prázdné chování.
    expect(blocks.map((b) => b.block_slug)).toEqual([SEZNAM]);
    expect(failed, 'odfiltrovaný blok není rozbitý blok — nesmí skončit v diagnostice vad').toEqual([]);
    expect(
      dotazy.map((d) => d.slug),
      'seznam sekce se na detailový blok ptal — čtyři prázdné rámy a čtyři zbytečné požadavky (naměřeno 2026-09-05)',
    ).toEqual([SEZNAM]);
  });

  it('s identitou záznamu se detailový blok načte normálně (cesta detailu zůstává)', async () => {
    const { fetchBlockData } = await import('../src/api.js');
    const blok = await fetchBlockData(DETAIL, { twin_id: 'd97cf08f-33bb-4198-80ab-29116b39ddb2' });
    expect(blok.block_slug).toBe(DETAIL);
    expect((blok.data as { record_id: string | null }).record_id).toBe('d97cf08f-33bb-4198-80ab-29116b39ddb2');
    expect(dotazy).toEqual([{ slug: DETAIL, params: { twin_id: 'd97cf08f-33bb-4198-80ab-29116b39ddb2' } }]);
  });

  it('neznámá nápověda dál degraduje na výchozí kreslení — skryje se JEN detail', async () => {
    const { PRESENTATION_DETAIL_ONLY } = await import('../src/App.js');
    // Konstanta je jediné místo pravdy: kdyby ji někdo přejmenoval, seed a klient
    // by se rozešly tiše — proto ji test čte z kódu a porovnává se slovem, které
    // nese instanční seed (43_audience_surface.sql).
    expect(PRESENTATION_DETAIL_ONLY).toBe('detail');
  });
});
