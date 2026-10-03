/**
 * @vitest-environment jsdom
 *
 * Brána (ADR-003 K5): osy přepínače pohledu jsou DATA sekce, ne konstanta
 * v klientovi — a nedeklaruje-li sekce nic, přepínač prostě NENÍ.
 *
 * ⛔ NAMĚŘENO 2026-09-06: seznam os byl v `App.tsx` konstantou a nesl jména věcí
 * jedné instance (`owner_company`, `unit_site`). Druhá instance tím dostala
 * přepínač, který mlčí: obě osy vracely nula voleb, lišta se nevykreslila, a
 * vlastní osu si nešlo přidat jinak než editací forku.
 *
 * CO SE MĚŘÍ:
 *   1. deklaruje-li sekce osy, kreslí se ONY — a klient se neptá na nic jiného
 *      (žádná zděděná jména už do databáze nechodí);
 *   2. nedeklaruje-li nic, klient se NEDOPTÁVÁ a lišta zmizí (dřív by nabídl
 *      osy jiného produktu, z nichž jedna navíc nic nefiltrovala);
 *   3. osa bez voleb se nevykreslí (přepínač nesmí nabízet prázdno).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../src/auth.js', () => ({ getToken: async () => 'test-token' }));

let server: http.Server;
let base = '';
/** Co se ptalo: cesta RPC + parametry. */
const dotazy: Array<{ path: string; params: Record<string, unknown> }> = [];
/** Co vrátí `get_surface_scope_axes` — test si to přepíná. */
let deklarovane: unknown[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const body = raw ? (JSON.parse(raw) as { p_params?: Record<string, unknown> }) : {};
      dotazy.push({ path: url.pathname, params: body.p_params ?? {} });
      const send = (v: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      if (url.pathname === '/rpc/get_surface_scope_axes') {
        return send({ data: { surface: body.p_params?.surface, axes: deklarovane }, provenance: {} });
      }
      if (url.pathname === '/rpc/get_scope_options') {
        // Můstek: jen jedna z legacy os má v datech co nabídnout.
        const key = String(body.p_params?.key ?? body.p_params?.source ?? '');
        return send({ data: { options: key === 'unit_site' ? [{ value: 'Kraslice', count: 3 }] : [] }, provenance: {} });
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'not found' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = {
    config: {
      instance_slug: 'axes-test',
      api: { postgrest_url: base, token_exchange_url: base },
      auth: { issuer: base, client_id: 'c' },
      i18n: { default_locale: 'en', locales: ['en'] },
      snapshot_public_jwk: null,
      preview: { enabled: false }
    },
    i18n: { en: {} }
  };
});
afterAll(() => server.close());
afterEach(() => {
  vi.restoreAllMocks();
  dotazy.length = 0;
  deklarovane = [];
});

describe('osy pohledu jsou data sekce', () => {
  it('deklarované osy se použijí a klient se na nic jiného neptá', async () => {
    deklarovane = [
      { axis_key: 'instance.druh', title_key: 'app.scope.axis.kind', dim: 'entity_type', options: [{ value: 'person', count: 812 }] },
      { axis_key: 'instance.skupina', title_key: 'app.scope.axis.group', dim: 'skupina', options: [{ value: 'zajemce', count: 40 }] }
    ];
    const { fetchScopeAxes } = await import('../src/api.js');
    const osy = await fetchScopeAxes('registr');
    expect(osy.map((o) => o.axis_key)).toEqual(['instance.druh', 'instance.skupina']);
    expect(osy[0]?.dim, 'pod jménem `dim` jde volba do bloků sekce').toBe('entity_type');
    expect(
      dotazy.map((d) => d.path),
      'jediný dotaz je na deklaraci — žádná zděděná jména os už do databáze nechodí',
    ).toEqual(['/rpc/get_surface_scope_axes']);
  });

  it('bez deklarace se klient nedoptává a lišta zmizí', async () => {
    deklarovane = [];
    const { fetchScopeAxes } = await import('../src/api.js');
    const osy = await fetchScopeAxes('porada');
    // Dřív by tu klient nabídl osy JINÉHO produktu (owner_company, unit_site),
    // z nichž `unit_site` navíc nečetlo ani jedno RPC. „Nic nedeklarováno" je
    // poctivá odpověď: sekce se chová jako dřív, tedy všechna data.
    expect(osy).toEqual([]);
    expect(dotazy.filter((d) => d.path === '/rpc/get_scope_options'), 'žádné doptávání se na cizí osy').toHaveLength(0);
  });

  it('deklarovaná osa bez voleb se na lištu nedostane', async () => {
    const { ScopeLens } = await import('../src/App.js');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const axes = [
      { axis_key: 'a.prazdna', title_key: 'k.prazdna', dim: 'nic', options: [] },
      { axis_key: 'a.plna', title_key: 'k.plna', dim: 'neco', options: [{ value: 'x', count: 1 }] }
    ];
    const html = renderToStaticMarkup(<ScopeLens axes={axes} active={null} onPick={() => {}} />);
    expect(html).toContain('data-axis="a.plna"');
    expect(html, 'prázdná osa na liště = přepínač nabízí, podle čeho se přepnout nedá').not.toContain('data-axis="a.prazdna"');
    // Samé prázdné osy = žádná lišta (sekce se chová jako dřív, všechna data).
    const jenPrazdna = axes.filter((a) => a.options.length === 0);
    expect(renderToStaticMarkup(<ScopeLens axes={jenPrazdna} active={null} onPick={() => {}} />)).toBe('');
  });
});
