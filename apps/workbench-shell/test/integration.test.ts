/**
 * Integrační test kontraktu: workbench api vrstva proti MOCK PostgREST (skutečné HTTP,
 * skutečná schema validace). Pokrývá čtení (layout + detail s p_params), fail-closed
 * sensitivity, a NOVOU zápisovou cestu „příprava" (submit_evidence_review_audited).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SurfaceBlock } from '@aisha/surface-blocks';

vi.mock('../src/auth.js', () => ({ getToken: async () => 'test-token' }));

const provenance = { source_slug: 'local-ingest', freshness_at: '2026-07-10T06:00:00Z', trace_id: 'tr-int' };

const detailBlock = (sensitivity: string): SurfaceBlock =>
  ({
    schema_version: 1,
    block_slug: 'doc_detail',
    block_type: 'record_detail',
    title_key: 'app.wb.doc.detail.title',
    sensitivity,
    provenance,
    data: { record_id: 'doc-1', fields: [{ key: 'amount', label_key: 'app.wb.field.amount', value: '120000' }] }
  }) as SurfaceBlock;

let server: http.Server;
let base = '';
const seen: { lastBlockParams?: unknown; lastReview?: unknown } = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Bearer test-token') return send(401, { message: 'JWT required' });
    const url = new URL(req.url ?? '/', 'http://x');
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (url.pathname === '/rpc/get_surface_layout') {
        return send(200, {
          schema_version: 1,
          surface: body.p_surface,
          blocks: [{ block_slug: 'doc_detail', block_type: 'record_detail', title_key: 'app.wb.doc.detail.title', position: 0 }]
        });
      }
      if (url.pathname === '/rpc/list_surface_sections') {
        return send(200, [
          { section: 'porada', block_count: 7 },
          { section: 'workbench', block_count: 8 }
        ]);
      }
      if (url.pathname === '/rpc/get_block_data') {
        seen.lastBlockParams = body.p_params;
        const slug = body.p_block_slug;
        return send(200, slug === 'secret' ? detailBlock('atlantis') /* unknown value */ : detailBlock('confidential'));
      }
      if (url.pathname === '/rpc/submit_evidence_review_audited') {
        seen.lastReview = body;
        return send(200, { entity_kind: body.p_entity_kind, entity_id: body.p_entity_id, decision: body.p_decision, state: 'HUMAN_CONFIRMED' });
      }
      return send(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  (globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = {
    config: {
      instance_slug: 'wbint',
      api: { postgrest_url: base, token_exchange_url: base },
      auth: { issuer: base, client_id: 'c' },
      i18n: { default_locale: 'en', locales: ['en'] },
      snapshot_public_jwk: null,
      preview: { enabled: false },
      workbench: { detail_blocks: ['doc_detail', 'doc_obligations'] }
    },
    i18n: { en: {} }
  };

  // Studený import api.js (kompilace schémat bloků) je PŘÍPRAVA, ne měřené chování.
  // Uvnitř prvního testu se počítal do jeho 5s limitu a pod zátěží runneru ho shodil
  // (riq #401, běh 52893: 5 260 ms, lokálně < 1 s). Testy níž berou modul z cache.
  await import('../src/api.js');
}, 60_000);

afterAll(() => server.close());

describe('workbench ⇄ PostgREST kontrakt (mock, skutečné HTTP)', () => {
  it('načte workbench layout přes RPC (p_surface=workbench)', async () => {
    const { fetchSectionLayout } = await import('../src/api.js');
    const layout = await fetchSectionLayout('workbench');
    expect(layout.surface).toBe('workbench');
    expect(layout.blocks[0]?.block_type).toBe('record_detail');
  });

  it('objevuje sekce z backendu a načte layout KTERÉKOLI z nich', async () => {
    // The property: no section name is baked into the client. This shell used to
    // hardcode 'workbench', which is exactly why 'porada' — 7 blocks of real
    // data — had no web client at all. A section the backend serves must be
    // reachable without a client release.
    const { fetchSections, fetchSectionLayout } = await import('../src/api.js');
    const sections = await fetchSections();
    expect(sections.map((s) => s.section)).toEqual(['porada', 'workbench']);
    for (const s of sections) {
      expect((await fetchSectionLayout(s.section)).surface).toBe(s.section);
    }
  });

  it('scopuje detail dokumentu přes p_params (master-detail navigace)', async () => {
    // Property, not spelling: the scope key must be one the detail RPCs actually
    // read — get_document_detail/get_obligation_queue key on p_params->>'document_id'
    // (alias 'doc_slug'). The old example pinned 'p_document_id', which the RPC never
    // reads, so the test stayed green while every live detail came back empty.
    const { fetchBlockData } = await import('../src/api.js');
    const block = await fetchBlockData('doc_detail', { document_id: 'doc-1' });
    expect(block.block_type).toBe('record_detail');
    expect(seen.lastBlockParams).toEqual({ document_id: 'doc-1' });
  });

  it('fail-closed: blok s neznámou sensitivity je odmítnut (schema enum je první obranná vrstva; cap=confidential je maximální)', async () => {
    const { fetchBlockData } = await import('../src/api.js');
    // Two fail-closed layers guard this: the sensitivity enum in schema validation, and
    // assertRenderable(cap). On the workbench cap='confidential' (maximal), so an unknown
    // value is rejected by the schema layer first — either way the block never renders.
    await expect(fetchBlockData('secret')).rejects.toThrow(/contract violation|exceeds cap/);
  });

  it('příprava: submit_evidence_review_audited pošle správné parametry s bearer tokenem', async () => {
    const { submitReview } = await import('../src/api.js');
    const r = await submitReview('obligation', 'o1', 'HUMAN_CONFIRMED', { note: 'ok po kontrole' });
    expect(r.state).toBe('HUMAN_CONFIRMED');
    // p_evidence se NEPOSÍLÁ, když není co poslat: server ho přijímá jen pro milníky
    // a prázdný objekt by u schvalování závazku znamenal „přišel důkaz", což nepřišel.
    expect(seen.lastReview).toEqual({
      p_entity_kind: 'obligation',
      p_entity_id: 'o1',
      p_decision: 'HUMAN_CONFIRMED',
      p_note: 'ok po kontrole'
    });
  });

  it('předání: podpis a jméno jdou TOUŽ auditovanou cestou, poloha se neposílá', async () => {
    const { submitReview } = await import('../src/api.js');
    // Regrese na doloženou vadu: milníky obcházely dispatcher a volaly
    // complete_workflow_step přímo, takže jediný zápis s právní váhou byl jediný
    // zápis BEZ řádku v audit_journal.
    await submitReview('workflow_step', 's1', 'HUMAN_CONFIRMED', {
      recipient: 'Jan Novák',
      signature: 'data:image/png;base64,AAAA',
      note: 'vše v pořádku'
    });
    expect(seen.lastReview).toEqual({
      p_entity_kind: 'workflow_step',
      p_entity_id: 's1',
      p_decision: 'HUMAN_CONFIRMED',
      p_note: 'vše v pořádku',
      p_evidence: { recipient: 'Jan Novák', signature: 'data:image/png;base64,AAAA' }
    });
    // Poloha není mezi odeslanými klíči — odvozuje ji server z příjezdového
    // signálu a telematiky. Souřadnice od dokumentovaného není důkaz.
    expect(JSON.stringify(seen.lastReview)).not.toMatch(/lat|lon|geo/);
  });
});
