import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Asking the data — the properties that must hold, not the wording:
 *
 *  1. The typed question reaches the answering RPC under the key the RPC READS
 *     (`question`). This is the class of bug that made every document detail come
 *     back empty: the shell sent `p_document_id`, the RPC keyed on `document_id`,
 *     and the test pinned the shell's spelling, so it stayed green over a hole.
 *  2. The answer is never shown without its source (provenance doctrine).
 *  3. WHICH block answers is configuration, not a slug baked into the shell.
 */

const bundle = {
  config: {
    instance_slug: 'test',
    api: { postgrest_url: 'http://x', token_exchange_url: 'http://x' },
    auth: { issuer: 'http://x', client_id: 'c' },
    i18n: { default_locale: 'en', locales: ['en'] },
    snapshot_public_jwk: null,
    preview: { enabled: false },
    ask: { answer_block: 'instance_specific_answer_block' }
  },
  i18n: {
    en: {
      'app.ask.scope': 'Data query',
      'app.ask.prompt': 'Ask about your data',
      'app.ask.placeholder': 'e.g. who are the tenants?',
      'app.ask.submit': 'Ask',
      'app.ask.disclaimer': 'Verify before deciding.',
      'app.cols.answer': 'Answer',
      'app.cols.coverage': 'Coverage',
      'app.provenance.source': 'Source'
    }
  }
};
(globalThis as Record<string, unknown>).__AISHA_INSTANCE__ = bundle;

const seen: { fn?: string; body?: Record<string, unknown> } = {};
vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init: { body: string }) => {
    seen.fn = String(url).split('/rpc/')[1];
    seen.body = JSON.parse(init.body) as Record<string, unknown>;
    return {
      ok: true,
      json: async () => ({
        schema_version: 1,
        block_slug: 'instance_specific_answer_block',
        block_type: 'table',
        title_key: 'app.cols.answer',
        sensitivity: 'confidential',
        provenance: { source_slug: 'answer_verified_facts', freshness_at: '2026-07-29T07:00:00Z', trace_id: 'a1' },
        data: {
          columns: [
            { key: 'odpoved', label_key: 'app.cols.answer' },
            { key: 'pokryti', label_key: 'app.cols.coverage' }
          ],
          rows: [{ odpoved: 'The site has 33 tenants.', pokryti: 'full' }]
        }
      })
    };
  })
);

// getToken() must not go near real auth in a unit test.
vi.mock('../src/auth.js', () => ({ getToken: async () => 'tok' }));

const { Ask } = await import('../src/components/Ask.js');
const { fetchBlockData } = await import('../src/api.js');

describe('ask (question → grounded answer)', () => {
  it('sends the question under the key the answering RPC reads, to the CONFIGURED block', async () => {
    await fetchBlockData(bundle.config.ask.answer_block, { question: 'Who are the tenants?' });

    expect(seen.fn).toBe('get_block_data');
    // The dispatcher takes (p_block_slug, p_params); the question travels INSIDE
    // p_params under `question` — get_answer_block reads p_params->>'question'.
    expect(seen.body?.p_block_slug).toBe('instance_specific_answer_block');
    expect(seen.body?.p_params).toEqual({ question: 'Who are the tenants?' });
  });

  it('renders the answer with its source, and offers an input to ask', () => {
    const html = renderToStaticMarkup(<Ask blockSlug="instance_specific_answer_block" />);
    // An input exists: without it the panel is a decoration, which is exactly
    // what shipped before — a full answering chain with nothing to type into.
    expect(html).toContain('<input');
    expect(html).toContain('Ask'); // submit label, via i18n key
    expect(html).toContain('e.g. who are the tenants?');
  });

  it('never bakes an instance block slug into the shell', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/components/Ask.tsx', import.meta.url), 'utf8')
    );
    expect(src).not.toContain('ask_answer');
  });
});

describe('readChainAnswer — governed-chat reply onto the panel shape', () => {
  it('maps message.content + run id, and refuses empty/blank replies', async () => {
    const { readChainAnswer } = await import('../src/components/Ask.js');
    expect(readChainAnswer({ message: { content: ' Odpověď. ' }, metadata: { run_id: 'abcdef12-3456' } }))
      .toEqual({ answer: 'Odpověď.', sources: ['ai_runs:abcdef12'] });
    expect(readChainAnswer({ message: { content: '   ' } })).toBeNull();
    expect(readChainAnswer({})).toBeNull();
    expect(readChainAnswer(null)).toBeNull();
  });

  /**
   * The property: the SERVER owns the conversation id and the client must carry
   * it back. Dropping it is not a cosmetic loss — /chat mints a new conversation
   * for a request without one, so history is re-read empty every turn and every
   * memory keyed on the id (session store, compaction, engagement signals) stays
   * dead. Measured on the deployed bundle: the string `conversation_id` did not
   * appear in it at all.
   */
  it('carries the conversation id back off the reply', async () => {
    const { readChainAnswer } = await import('../src/components/Ask.js');
    const r = readChainAnswer({
      message: { content: 'Ano.' },
      conversation_id: '11111111-2222-3333-4444-555555555555'
    });
    expect(r?.conversationId).toBe('11111111-2222-3333-4444-555555555555');
    // Absent or blank must not invent one — the next turn then asks for a mint.
    expect(readChainAnswer({ message: { content: 'Ano.' } })?.conversationId).toBeUndefined();
    expect(readChainAnswer({ message: { content: 'Ano.' }, conversation_id: '' })?.conversationId).toBeUndefined();
  });
});

describe('silent degradation must stay visible', () => {
  /**
   * When the instance wires ask.chat_path but the chain does not answer, the
   * deterministic RPC takes over. That is correct behaviour — but on the live
   * extranet it was the PERMANENT state (21/21 calls to /chat returned 401 over
   * 72 h) and nothing distinguished it from a working chain. The gate pins that
   * the substitute is marked, without pinning the marker's wording.
   */
  it('marks the substitute in provenance — but only where a chain was wired', async () => {
    const { markFallback, CHAIN_DOWN } = await import('../src/components/Ask.js');

    // Chain wired but silent → the answer must carry the marker alongside its
    // own source, so the reader can tell WHICH lane produced it.
    expect(markFallback({ sources: ['answer_verified_facts'] }, true).sources)
      .toEqual(['answer_verified_facts', CHAIN_DOWN]);
    // …even when the block returned no provenance of its own.
    expect(markFallback({} as { sources?: string[] }, true).sources).toEqual([CHAIN_DOWN]);
    // No chain configured → the RPC IS the lane; marking it would be a lie.
    expect(markFallback({ sources: ['answer_verified_facts'] }, false).sources)
      .toEqual(['answer_verified_facts']);
  });
});

describe('fakta hned, AISHA doplní (majitel 2026-09-29: model uvnitř je pomalý)', () => {
  /**
   * Dřív šel dotaz nejdřív do řetězu a ověřená odpověď přišla až po jeho selhání.
   * S modelem na CPU (odpověď desítky sekund) by uživatel čekal na prázdný panel.
   * Pinuje se POŘADÍ a mezistavy, ne slova.
   */
  const fakta = { answer: 'Dluh po splatnosti 900 Kč.', figures: [], sources: ['answer_verified_facts'] };

  it('fakta dorazí PŘED formulací a formulace je pak nahradí (zdroje faktů zůstanou)', async () => {
    const { odpovedVeDvouKrocich } = await import('../src/components/Ask.js');
    let pust: (v: { answer: string; sources: string[] }) => void = () => {};
    const retez = () => new Promise<{ answer: string; sources: string[] }>((r) => { pust = r; });
    const zmeny: Array<Record<string, unknown>> = [];
    const hotovo = odpovedVeDvouKrocich(async () => fakta, retez, (z) => zmeny.push(z));
    await new Promise((r) => setTimeout(r, 0));
    // řetěz ještě neodpověděl — uživatel už vidí fakta a ví, že AISHA formuluje
    expect(zmeny).toEqual([{ ...fakta, refining: true }]);
    pust({ answer: 'Firma dluží po splatnosti 900 Kč.', sources: ['ai_runs:abcd1234'] });
    await hotovo;
    expect(zmeny[1]).toEqual({
      answer: 'Firma dluží po splatnosti 900 Kč.',
      sources: ['answer_verified_facts', 'ai_runs:abcd1234'],
      refining: false
    });
  });

  it('řetěz mlčí (nebo vypršel) → fakta zůstanou a provenience přizná výpadek', async () => {
    const { odpovedVeDvouKrocich, CHAIN_DOWN } = await import('../src/components/Ask.js');
    const zmeny: Array<Record<string, unknown>> = [];
    await odpovedVeDvouKrocich(async () => fakta, async () => null, (z) => zmeny.push(z));
    expect(zmeny[0]).toMatchObject({ answer: fakta.answer, refining: true });
    expect(zmeny[1]).toEqual({ sources: ['answer_verified_facts', CHAIN_DOWN], refining: false });
  });

  it('bez zapojeného řetězu jen fakta, bez mezistavu a bez značky výpadku', async () => {
    const { odpovedVeDvouKrocich } = await import('../src/components/Ask.js');
    const zmeny: Array<Record<string, unknown>> = [];
    await odpovedVeDvouKrocich(async () => fakta, null, (z) => zmeny.push(z));
    expect(zmeny).toEqual([{ ...fakta, refining: false }]);
  });

  it('kanál z faktů vrátil JEN fakta → zůstanou naše fakta, zdroj přizná proč (ne „AISHA formulovala")', async () => {
    const { odpovedVeDvouKrocich, readChainAnswer } = await import('../src/components/Ask.js');
    // tvar odpovědi svc-ai-chat /chat pro kanál z faktů, hlídač zastavil cizí číslo;
    // obsah = fakta serveru + tierové upozornění — to NECHCEME místo našich faktů
    const odpovedServeru = {
      conversation_id: 'c-1',
      message: { content: 'Dluh po splatnosti 900 Kč.\n\n---\n*upozornění*' },
      metadata: { run_id: 'abcdef12-3456', grounding: { verdict: 'fakta', reason: 'cizi_cisla' } }
    };
    const r = readChainAnswer(odpovedServeru);
    expect(r).toMatchObject({ zFaktu: true, sources: ['ai_runs:abcdef12', 'aisha-chat:fakta:cizi_cisla'], conversationId: 'c-1' });
    const zmeny: Array<Record<string, unknown>> = [];
    await odpovedVeDvouKrocich(async () => fakta, async () => r, (z) => zmeny.push(z));
    expect(zmeny[1]).toEqual({
      sources: ['answer_verified_facts', 'ai_runs:abcdef12', 'aisha-chat:fakta:cizi_cisla'],
      refining: false,
      conversationId: 'c-1'
    });
    expect(zmeny[1]).not.toHaveProperty('answer');
  });

  it('KONTROLNÍ VZOREK: formulace modelu (verdikt model) fakta NAHRADÍ', async () => {
    const { readChainAnswer } = await import('../src/components/Ask.js');
    const r = readChainAnswer({ message: { content: 'Firma dluží 900 Kč.' }, metadata: { grounding: { verdict: 'model', reason: 'model' } } });
    expect(r).toEqual({ answer: 'Firma dluží 900 Kč.', sources: ['aisha-chat'] });
  });

  it('fakta selžou, řetěz vrátí jen fakta serveru → ukáže se odpověď serveru', async () => {
    const { odpovedVeDvouKrocich } = await import('../src/components/Ask.js');
    const a: Array<Record<string, unknown>> = [];
    await odpovedVeDvouKrocich(async () => { throw new Error('x'); }, async () => ({ answer: 'F', sources: ['aisha-chat:fakta:model_obsazen'], zFaktu: true }), (z) => a.push(z));
    expect(a).toEqual([{ answer: 'F', sources: ['aisha-chat:fakta:model_obsazen'], refining: false }]);
  });

  it('fakta selžou, řetěz odpoví → odpověď řetězu; selže obojí → chyba', async () => {
    const { odpovedVeDvouKrocich } = await import('../src/components/Ask.js');
    const a: Array<Record<string, unknown>> = [];
    await odpovedVeDvouKrocich(async () => { throw new Error('x'); }, async () => ({ answer: 'A', sources: ['aisha-chat'] }), (z) => a.push(z));
    expect(a).toEqual([{ answer: 'A', sources: ['aisha-chat'], refining: false }]);
    const b: Array<Record<string, unknown>> = [];
    await odpovedVeDvouKrocich(async () => { throw new Error('x'); }, async () => null, (z) => b.push(z));
    expect(b).toEqual([{ errorKey: 'app.ask.error', refining: false }]);
  });
});
