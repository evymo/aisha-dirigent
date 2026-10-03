/**
 * @vitest-environment jsdom
 *
 * Brána (ADR-003, K4 „akce správy z plochy"): maska `action_form` se kreslí
 * z DEKLARACE (allowlist akcí + pole), a odeslání jde přes JEDNO auditované
 * RPC se slugem, cílem a payloadem — klient nikdy nezná jméno cílové funkce.
 *
 * CO SE MĚŘÍ:
 *   1. statický render: tlačítko za každou akci (data-action=slug), bez identity
 *      cíle jsou tlačítka zakázaná (blok mimo detail nemá nad čím běžet);
 *   2. `submitSurfaceAction` posílá {p_action_slug, p_target, p_payload} na
 *      /rpc/submit_surface_action a vrací odpověď serveru beze změny;
 *   3. odmítnutí serveru (42501/22023) se propaguje jako výjimka — shell ji
 *      ukáže jako `app.action.failed`, nikdy ji nespolkne.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActionFormBlock } from '@aisha/surface-blocks';

vi.mock('../src/auth.js', () => ({ getToken: async () => 'test-token' }));

const provenance = { source_slug: 'surface_actions', freshness_at: '2026-09-06T08:00:00Z', trace_id: 'surface-actions:twin' };

const blok = (targetId: string | null): ActionFormBlock => ({
  schema_version: 1,
  block_slug: 'blok_akce',
  block_type: 'action_form',
  title_key: 'app.blocks.blok_akce.title',
  sensitivity: 'restricted',
  provenance,
  data: {
    target_kind: 'twin',
    target_id: targetId,
    actions: [
      {
        slug: 'followup.create',
        title_key: 'app.actions.followup.create',
        fields: [
          { key: 'due_at', label_key: 'app.fields.due_at', type: 'timestamptz', required: true },
          { key: 'note', label_key: 'app.fields.note', type: 'textarea' }
        ]
      },
      {
        slug: 'tag.add',
        title_key: 'app.actions.tag.add',
        fields: [
          {
            key: 'label',
            label_key: 'app.fields.label',
            type: 'enum',
            required: true,
            options: [{ value: 'vip', label_key: 'app.opts.vip' }]
          }
        ]
      }
    ]
  }
});

let server: http.Server;
let base = '';
const prijate: Array<{ path: string; body: Record<string, unknown> }> = [];
let odpoved: { code: number; body: unknown } = { code: 200, body: { ok: true } };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      prijate.push({ path: url.pathname, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} });
      res.writeHead(odpoved.code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(odpoved.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = {
    config: {
      instance_slug: 'action-test',
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
  prijate.length = 0;
  odpoved = { code: 200, body: { ok: true } };
});

describe('maska action_form', () => {
  it('kreslí tlačítko za každou akci z allowlistu; bez identity cíle jsou zakázaná', async () => {
    const { Block } = await import('../src/components/blocks.js');
    const handlers = { onAction: async () => {} };
    const sIdentitou = renderToStaticMarkup(<Block block={blok('d97cf08f-33bb-4198-80ab-29116b39ddb2')} handlers={handlers} />);
    expect(sIdentitou).toContain('data-action="followup.create"');
    expect(sIdentitou).toContain('data-action="tag.add"');
    expect(sIdentitou, 'tlačítka s identitou a handlerem nesmí být disabled').not.toMatch(/data-action="followup\.create"[^>]*disabled|disabled[^>]*data-action="followup\.create"/);
    // Bez identity: blok stojí mimo detail (např. starší shell bez filtru) — akce se vypíší, ale nedají spustit.
    const bezIdentity = renderToStaticMarkup(<Block block={blok(null)} handlers={handlers} />);
    expect(bezIdentity).toContain('data-action="tag.add"');
    expect(bezIdentity).toMatch(/<button[^>]*disabled[^>]*data-action="tag\.add"|<button[^>]*data-action="tag\.add"[^>]*disabled/);
    // Akce BEZ cíle (target_kind 'none') identitu nepotřebuje — musí jít spustit hned.
    const bezCile = blok(null);
    bezCile.data.target_kind = 'none';
    const zadnyCil = renderToStaticMarkup(<Block block={bezCile} handlers={handlers} />);
    expect(zadnyCil, 'akce bez cíle nesmí čekat na výběr záznamu').not.toMatch(/<button[^>]*disabled[^>]*data-action="tag\.add"|<button[^>]*data-action="tag\.add"[^>]*disabled/);
    // Formulář se před volbou akce nekreslí — žádné pole, žádný submit.
    expect(sIdentitou).not.toContain('data-action-form=');
  });

  it('submitSurfaceAction posílá slug + cíl + payload do JEDNOHO auditovaného RPC a vrací odpověď serveru', async () => {
    odpoved = { code: 200, body: { ok: true, action_slug: 'followup.create', result: { beat_id: 'b1' } } };
    const { submitSurfaceAction } = await import('../src/api.js');
    const r = await submitSurfaceAction(
      'followup.create',
      { twin_id: 'd97cf08f-33bb-4198-80ab-29116b39ddb2' },
      { due_at: '2026-09-10T09:00', note: 'zavolat' }
    );
    expect(r).toEqual({ ok: true, action_slug: 'followup.create', result: { beat_id: 'b1' } });
    expect(prijate).toEqual([
      {
        path: '/rpc/submit_surface_action',
        body: {
          p_action_slug: 'followup.create',
          p_target: { twin_id: 'd97cf08f-33bb-4198-80ab-29116b39ddb2' },
          p_payload: { due_at: '2026-09-10T09:00', note: 'zavolat' }
        }
      }
    ]);
  });

  it('odmítnutí serveru se propaguje jako výjimka (shell ho ukáže, nespolkne)', async () => {
    odpoved = { code: 403, body: { code: '42501', message: 'DENIED: action not allowed' } };
    const { submitSurfaceAction } = await import('../src/api.js');
    await expect(submitSurfaceAction('tag.add', { twin_id: 'x' }, { label: 'vip' })).rejects.toThrow();
  });
});
