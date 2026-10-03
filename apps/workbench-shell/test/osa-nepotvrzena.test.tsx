/**
 * @vitest-environment jsdom
 *
 * (jsdom kvůli SDK, stejně jako console-odolnost: App.tsx si ho tahá přes sdk.ts.)
 *
 * Brána: blok, který zvolený pohled NEPOTVRDIL, to u sebe přizná.
 *
 * ⛔ NAMĚŘENO 2026-09-28: v sekci Smlouvy pět bloků z deseti zvolenou firmu tiše
 * ignorovalo — pohled šel do každého bloku, ale číst ho uměla jen polovina, a pod
 * „Areál Avant" tak vedle sebe stály dlužníci Avantu a jednotky celého podniku.
 * Filtrující RPC to teď říká v `provenance.scope_effective` (DB `scope_applied`);
 * konzole porovná svůj pohled s tím, co blok potvrdil, a mlčícímu bloku připíše
 * `scope_ignored`. Měří se tu tři věci:
 *   1. blok s `scope_effective` projde kontraktem (Ajv je all-or-nothing — kdyby
 *      schéma pole neznalo, blok by zmizel a test by to poznal);
 *   2. `scope_ignored` dostane PŘESNĚ ten blok, který pohled nepotvrdil — i ten,
 *      který ohlásil JINOU hodnotu;
 *   3. poznámka se vykreslí jen u něj.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SurfaceBlock } from '@aisha/surface-blocks';

vi.mock('../src/auth.js', () => ({ getToken: async () => 'test-token' }));

const FIRMA = 'Areál Avant Ďáblická';
const POZNAMKA = 'Not filtered by the selected view';

const coord = (value: string) => ({ dim: 'owner_company', value, origin: 'user_pick', confidence: 1, resolver: 'none' });
const blok = (slug: string, effective?: ReturnType<typeof coord>[]): SurfaceBlock =>
  ({
    schema_version: 1,
    block_slug: slug,
    block_type: 'kpi_tile',
    title_key: `app.blocks.${slug}.title`,
    sensitivity: 'internal',
    provenance: {
      source_slug: 'li-evidence-registry',
      freshness_at: '2026-09-28T20:00:00Z',
      trace_id: `tr-${slug}`,
      ...(effective ? { scope_effective: effective } : {}),
    },
    data: { value: 7 },
  }) as SurfaceBlock;

const POTVRDIL = blok('potvrdil', [coord(FIRMA)]);
const MLCI = blok('mlci');
const ODPOVEDI: Record<string, SurfaceBlock> = {
  potvrdil: POTVRDIL,
  mlci: MLCI,
  jina_firma: blok('jina_firma', [coord('Slezské kamenolomy a.s.')]),
};

let server: http.Server;
const pozadovano: Array<Record<string, unknown>> = [];

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
          blocks: Object.keys(ODPOVEDI).map((s, i) => ({ block_slug: s, block_type: 'kpi_tile', title_key: s, position: i })),
        });
      }
      if (url.pathname === '/rpc/get_block_data') {
        pozadovano.push((body.p_params ?? {}) as Record<string, unknown>);
        return send(200, ODPOVEDI[String(body.p_block_slug)]);
      }
      return send(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = {
    config: {
      instance_slug: 'osa',
      api: { postgrest_url: base, token_exchange_url: base },
      auth: { issuer: base, client_id: 'c' },
      i18n: { default_locale: 'en', locales: ['en'] },
      snapshot_public_jwk: null,
      preview: { enabled: false },
      workbench: { detail_blocks: [] },
    },
    i18n: { en: { 'app.scope.not_applied': POZNAMKA } },
  };
});

afterAll(() => server.close());

describe('blok, který zvolený pohled nepotvrdil, to přizná', () => {
  it('scope_ignored nese přesně blok, který firmu nepotvrdil', async () => {
    const { loadConsole } = await import('../src/App.js');
    const { blocks, failed } = await loadConsole('smlouvy', { owner_company: FIRMA });

    expect(failed, 'scope_effective musí projít kontraktem bloku').toEqual([]);
    expect(pozadovano.every((p) => p.owner_company === FIRMA), 'pohled jde do každého bloku').toBe(true);
    const ignor = Object.fromEntries(
      blocks.map((b) => [b.block_slug, (b as SurfaceBlock & { scope_ignored?: string[] }).scope_ignored ?? []]),
    );
    expect(ignor.potvrdil).toEqual([]);
    expect(ignor.mlci, 'blok, který mlčí, filtroval jen v naší představě').toEqual(['owner_company']);
    expect(ignor.jina_firma, 'potvrzení JINÉ firmy není potvrzení té zvolené').toEqual(['owner_company']);
  });

  it('bez pohledu se nic nepřipisuje', async () => {
    const { loadConsole } = await import('../src/App.js');
    const { blocks } = await loadConsole('smlouvy');
    expect(blocks.some((b) => 'scope_ignored' in b)).toBe(false);
  });

  it('poznámka se vykreslí jen u bloku, který pohled nepotvrdil', async () => {
    const { Block } = await import('../src/components/blocks.js');
    // Tak, jak ho připojí loadConsole: kontraktní blok + `scope_ignored` vedle něj.
    const s = renderToStaticMarkup(<Block block={Object.assign({}, MLCI, { scope_ignored: ['owner_company'] })} />);
    const bez = renderToStaticMarkup(<Block block={POTVRDIL} />);
    expect(s).toContain(POZNAMKA);
    expect(bez).not.toContain(POZNAMKA);
  });
});
