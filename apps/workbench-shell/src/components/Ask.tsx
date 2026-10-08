import { useCallback, useRef, useState } from 'react';
import { AskPanel } from '@aisha/design-language';
import type { SurfaceBlock, TableBlock } from '@aisha/surface-blocks';
import { fetchBlockData } from '../api.js';
import { instance } from '../instance.js';
import { getIdpToken } from '../auth.js';
import { getLocale, t } from '../i18n.js';

/**
 * Ask — asking the data in plain language, and reading the answer back with its
 * source. The product's core loop: a question, a grounded answer, provenance.
 *
 * NOT a new block_type. The answer arrives through the ordinary block path
 * (get_block_data merges the caller's p_params into the block's own), so a typed
 * question reaches the answering RPC with no backend change and no new mask —
 * adding a block_type the deployed bundle does not know would break the whole
 * layout, not just this panel.
 *
 * WHICH block answers is DATA (instance config `ask.answer_block`), never a slug
 * baked into the shell: another instance points at its own answering RPC.
 *
 * Shape rule for that block (get_answer_block's own contract): the first column
 * is the prose answer, every further column is a figure shown beside it.
 */

/** Provenance marker appended when the instance wires the governed chain but the
 * chain did not answer. Exported so the gate pins the SIGNAL, not the wording. */
export const CHAIN_DOWN = 'chain:unavailable';

/**
 * Mark a deterministic answer as a SUBSTITUTE when the instance asked for the
 * governed chain and did not get one.
 *
 * Falling back is correct; hiding the fall is not. On the live extranet the
 * substitute had been answering every question for as long as anyone could
 * remember (21/21 calls to /chat returned 401 over 72 h) and its provenance was
 * indistinguishable from the real lane, so the outage read as normal operation.
 * An instance that never wired a chain is not degraded — hence `chainWired`.
 */
export function markFallback<T extends { sources?: string[] }>(answer: T, chainWired: boolean): T {
  if (!chainWired) return answer;
  return { ...answer, sources: [...(answer.sources ?? []), CHAIN_DOWN] };
}

/**
 * Provenance marker: knowledge search is UNAVAILABLE (the chain answered 503
 * KNOWLEDGE_SEARCH_UNAVAILABLE — embedding lane down, undeclared weights identity …).
 * Exported so the gate pins the SIGNAL, not the wording. P2 2026-10-06: an outage of the
 * search must never read as "nothing found" — the panel says it out loud (app.ask.searchUnavailable).
 */
export const SEARCH_DOWN = 'knowledge:unavailable';

/** A knowledge passage the answer drew on (server citation → panel shape). */
export interface Passage {
  ref: string;
  /** Source name for the provenance badge: the chunk slug, else the knowledge item id. */
  source: string;
  excerpt: string;
  /** The answer referenced it ([K1] …). */
  cited: boolean;
}

interface Exchange {
  question: string;
  /** Absent while in flight. */
  answer?: string;
  figures?: Array<{ value: string; label: string }>;
  sources?: string[];
  errorKey?: string;
  /** Ověřená odpověď už stojí, AISHA ji ještě formuluje (pomalý model uvnitř). */
  refining?: boolean;
  /** Úseky znalostí, ze kterých odpověď čerpala (P2). */
  passages?: Passage[];
  /** Hlasité upozornění (i18n klíč) — např. vyhledávání ve znalostech nedostupné. */
  noticeKey?: string;
}

type Fakta = Pick<Exchange, 'answer' | 'figures' | 'sources'>;
type Retez =
  | (Pick<Exchange, 'answer' | 'sources' | 'passages'> & {
      conversationId?: string;
      zFaktu?: boolean;
      /** Řetěz odpověděl 503 KNOWLEDGE_SEARCH_UNAVAILABLE — hledání ve znalostech nejde. */
      hledaniNedostupne?: boolean;
    })
  | null;

/**
 * POŘADÍ ODPOVĚDI: FAKTA HNED, AISHA DOPLNÍ (rozhodnutí majitele 2026-09-29).
 *
 * Dřív šel dotaz nejdřív do řetězu (/chat) a ověřená odpověď z dat přišla až
 * jako náhradník po jeho selhání. S modelem uvnitř na CPU (≈ 4 tokeny/s, odpověď
 * desítky sekund) by uživatel čekal na prázdný panel. Teď:
 *   1. ověřená odpověď z téhož RPC jako karta — HNED (mezistav `refining`, je-li
 *      řetěz zapojený);
 *   2. formulace AISHY ji nahradí, až dorazí — zdroje faktů zůstávají, přidá se
 *      zdroj běhu;
 *   3. řetěz mlčí nebo nestihl limit → fakta zůstanou a provenience PŘIZNÁ výpadek
 *      (markFallback), jako dosud;
 *   3b. řetěz odpověděl, ale jen fakty (kanál z faktů: model nic nepřidal, napsal
 *      číslo mimo fakta, byl obsazený…) → zůstanou NAŠE fakta a do zdrojů se
 *      připíše proč — žádné „AISHA formulovala", když neformulovala;
 *   4. nevyjdou fakta ani řetěz → chyba;
 *   5. (P2) řetěz hlásí, že vyhledávání ve znalostech NEJDE → fakta zůstanou a panel to řekne
 *      NAHLAS (noticeKey + SEARCH_DOWN v provenienci) — nikdy jako „nic nenalezeno“.
 * Čistá funkce nad dvěma kroky: pořadí a mezistavy jdou testovat bez Reactu.
 */
export async function odpovedVeDvouKrocich(
  fakta: () => Promise<Fakta>,
  retez: (() => Promise<Retez>) | null,
  zmena: (castecne: Partial<Exchange> & { conversationId?: string }) => void
): Promise<void> {
  let f: Fakta | null = null;
  try {
    f = await fakta();
    zmena({ ...f, refining: retez !== null });
  } catch {
    f = null;
  }
  if (!retez) {
    if (!f) zmena({ errorKey: 'app.ask.error', refining: false });
    return;
  }
  let r: Retez = null;
  try {
    r = await retez();
  } catch {
    r = null;
  }
  if (r?.hledaniNedostupne) {
    if (f) {
      zmena({ sources: [...(f.sources ?? []), SEARCH_DOWN], noticeKey: 'app.ask.searchUnavailable', refining: false });
    } else {
      zmena({ errorKey: 'app.ask.searchUnavailable', refining: false });
    }
  } else if (r?.zFaktu && f?.answer !== undefined) {
    zmena({
      sources: [...(f.sources ?? []), ...(r.sources ?? [])],
      refining: false,
      ...(r.passages ? { passages: r.passages } : {}),
      ...(r.conversationId ? { conversationId: r.conversationId } : {})
    });
  } else if (r) {
    zmena({
      answer: r.answer,
      sources: [...(f?.sources ?? []), ...(r.sources ?? [])],
      refining: false,
      ...(r.passages ? { passages: r.passages } : {}),
      ...(r.conversationId ? { conversationId: r.conversationId } : {})
    });
  } else if (f) {
    zmena({ sources: markFallback(f, true).sources, refining: false });
  } else {
    zmena({ errorKey: 'app.ask.error', refining: false });
  }
}

function isTable(block: SurfaceBlock): block is TableBlock {
  return block.block_type === 'table';
}

/** Read the answering block into the panel's shape, by its declared columns. */
function readAnswer(block: SurfaceBlock): Pick<Exchange, 'answer' | 'figures' | 'sources'> {
  const sources = block.provenance?.source_slug ? [block.provenance.source_slug] : [];
  if (!isTable(block)) return { sources };
  const [row] = block.data.rows;
  if (!row) return { sources };
  const [first, ...rest] = block.data.columns;
  const text = first ? row[first.key] : null;
  return {
    answer: typeof text === 'string' ? text : undefined,
    figures: rest
      // Hlavička je vždy překladový klíč (kontrakt tabulky); `key` jako záchrana.
      .map((c) => ({ value: row[c.key], label: c.label_key ? t(c.label_key) : c.key }))
      .filter((f): f is { value: string; label: string } => typeof f.value === 'string' && f.value.length > 0),
    sources
  };
}

/** Map a governed-chat reply onto the panel's shape. Pure and exported for
 * tests: the answer is `message.content`; the run id is provenance enough for
 * v1 (the chain's own tracer logged the full route in ai_runs).
 *
 * `conversationId` is read back because the SERVER owns it: /chat mints one on
 * a request that carries none. Dropping it here is what made every question a
 * fresh conversation — the service loaded history for an id nobody reused, so
 * it was always empty and session memory had nothing to key on. */
export function readChainAnswer(
  j: unknown
): (Pick<Exchange, 'answer' | 'sources' | 'passages'> & { conversationId?: string; zFaktu?: boolean }) | null {
  const r = j as
    | {
        message?: { content?: string };
        metadata?: {
          run_id?: string;
          grounding?: { verdict?: string; reason?: string };
          knowledge?: { citations?: unknown };
        };
        conversation_id?: string;
      }
    | null;
  const answer = r?.message?.content?.trim();
  if (!answer) return null;
  const run = r?.metadata?.run_id;
  // Kanál z faktů vrátil jen fakta (model nic nepřidal / hlídač ho zastavil):
  // zdroj nese důvod, odpověď zůstane naše (odpovedVeDvouKrocich, bod 3b).
  const g = r?.metadata?.grounding;
  const zFaktu = g?.verdict === 'fakta';
  // P2: úseky znalostí, ze kterých odpověď čerpala. Odkázané ([K#]) jsou i zdrojem odpovědi.
  const passages = readPassages(r?.metadata?.knowledge?.citations);
  return {
    answer,
    sources: [
      ...(run ? [`ai_runs:${run.slice(0, 8)}`] : ['aisha-chat']),
      ...(zFaktu ? [`aisha-chat:fakta:${g?.reason ?? '?'}`] : []),
      ...passages.filter((p) => p.cited).map((p) => `knowledge:${p.source}`)
    ],
    ...(passages.length ? { passages } : {}),
    ...(zFaktu ? { zFaktu: true } : {}),
    ...(typeof r?.conversation_id === 'string' && r.conversation_id ? { conversationId: r.conversation_id } : {})
  };
}

/** Server citations (svc-ai-chat metadata.knowledge.citations) → panel passages; junk is dropped. */
function readPassages(citations: unknown): Passage[] {
  if (!Array.isArray(citations)) return [];
  return citations.flatMap((c): Passage[] => {
    const o = (c ?? {}) as Record<string, unknown>;
    if (typeof o.ref !== 'string' || typeof o.excerpt !== 'string') return [];
    const source =
      typeof o.chunk_slug === 'string' && o.chunk_slug
        ? o.chunk_slug
        : typeof o.knowledge_item_id === 'string'
          ? o.knowledge_item_id
          : null;
    if (!source) return [];
    return [{ ref: o.ref, source, excerpt: o.excerpt, cited: o.cited === true }];
  });
}

/**
 * A failed chain reply → the LOUD knowledge-search outage, or null (any other failure keeps
 * the old behaviour: facts stay and provenance admits the chain is down). Pure, exported for
 * tests: the server's `code` decides, never the HTTP status alone.
 */
export function readChainFailure(j: unknown): Retez {
  const r = j as { code?: unknown } | null;
  return r?.code === 'KNOWLEDGE_SEARCH_UNAVAILABLE' ? { hledaniNedostupne: true } : null;
}

/** The governed chat lane, when the instance wires it (ask.chat_path). Any
 * failure returns null and the deterministic answer_block takes over — the
 * chain can only improve on the RPC, never break asking.
 *
 * ⚠️ That fallback is silent by design but must not be INVISIBLE. Measured on
 * the live extranet: 21/21 calls to /chat returned 401 over 72 h (the verifier
 * expected the internal Keycloak issuer), so every answer users had ever seen
 * came from the deterministic RPC — and nothing in the UI or the provenance
 * said so. A permanent degradation that reads as normal operation is worse than
 * an error, hence `chainDown` below. */
async function askChain(
  question: string,
  conversationId: string | null
): Promise<Retez> {
  const path = instance.config.ask?.chat_path;
  if (!path) return null;
  let url: string;
  try {
    url = new URL(path, new URL(instance.config.api.postgrest_url).origin).toString();
  } catch {
    return null;
  }
  const token = await getIdpToken();
  if (!token) return null;
  // Limit čekání na formulaci je DATA instance (`ask.chain_timeout_ms`); fakta
  // už uživatel má, takže vypršení jen ponechá ověřenou odpověď. Bez deklarace
  // se nečeká omezeně (dosavadní chování).
  const limit = instance.config.ask?.chain_timeout_ms;
  const abort = new AbortController();
  const casovac = typeof limit === 'number' && limit > 0 ? setTimeout(() => abort.abort(), limit) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: abort.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      // Send the id the server gave us last turn; omit it on the first turn so
      // /chat mints one. This is the entire memory wiring — everything downstream
      // (history, session memory, compaction, engagement signals) keys on it.
      // `language` = the reader's locale: the chain answers in it (and ranks same-language
      // knowledge first). Without it the server defaulted to English for every reader.
      body: JSON.stringify(
        conversationId
          ? { message: question, conversation_id: conversationId, language: getLocale() }
          : { message: question, language: getLocale() }
      )
    });
    if (!res.ok) return readChainFailure(await res.json().catch(() => null));
    return readChainAnswer(await res.json());
  } catch {
    return null;
  } finally {
    if (casovac) clearTimeout(casovac);
  }
}

/**
 * `initialDraft` = otázka předvyplněná z kontextu (karta firmy: „Co víme o …“).
 * Jen PŘEDVYPLNĚNÁ, ne odeslaná — ptá se člověk (odeslání je jeho čin), stroj mu
 * jen ušetří psaní. Stejný vzor jako „Zeptat se AISHY →“ v prototypu Modernizace.
 */
export function Ask({ blockSlug, initialDraft }: { blockSlug: string; initialDraft?: string }): JSX.Element {
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [log, setLog] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  // Answers may return out of order; only the newest question owns the panel.
  const latest = useRef(0);
  // The server's conversation id, carried across turns. A ref, not state: it
  // must not re-render the panel, and it must be readable by the next send
  // before React has committed anything.
  const conversation = useRef<string | null>(null);

  const ask = useCallback(async (): Promise<void> => {
    const question = draft.trim();
    if (!question || busy) return;
    const turn = ++latest.current;
    setBusy(true);
    setDraft('');
    // Předchozí výměna, kterou AISHA nestihla doformulovat, už „formuluje“ neukazuje —
    // její pozdní formulace se zahodí (patří starému tahu), fakta v ní zůstávají.
    setLog((prev) => [...prev.map((x) => (x.refining ? { ...x, refining: false } : x)), { question }]);
    const patch = (next: Partial<Exchange>): void =>
      setLog((prev) => prev.map((x, i) => (i === prev.length - 1 ? { ...x, ...next } : x)));
    const retezZapojen = Boolean(instance.config.ask?.chat_path);
    try {
      await odpovedVeDvouKrocich(
        async () => readAnswer(await fetchBlockData(blockSlug, { question })),
        retezZapojen ? () => askChain(question, conversation.current) : null,
        (castecne) => {
          // Id konverzace patří relaci, ne jedné výměně — drží se i u zastaralého tahu.
          const { conversationId, ...zbytek } = castecne;
          if (conversationId) conversation.current = conversationId;
          if (turn !== latest.current) return;
          patch(zbytek);
          // Fakta stojí → pole pro další otázku se uvolní, i když AISHA ještě formuluje.
          if (zbytek.answer !== undefined || zbytek.errorKey) setBusy(false);
        }
      );
    } finally {
      if (turn === latest.current) setBusy(false);
    }
  }, [blockSlug, draft, busy]);

  const open = log.length === 0;

  return (
    <section className="wb-ask">
      {open ? (
        <AskPanel
          scope={t('app.ask.scope')}
          question={t('app.ask.prompt')}
          disclaimer={t('app.ask.disclaimer')}
          placeholder={t('app.ask.placeholder')}
          submitLabel={t('app.ask.submit')}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void ask()}
          busy={busy}
        />
      ) : (
        log.map((x, i) => (
          <AskPanel
            key={i}
            scope={t('app.ask.scope')}
            question={x.question}
            answer={x.errorKey ? t(x.errorKey) : (x.answer ?? (busy && i === log.length - 1 ? '…' : undefined))}
            figures={x.figures}
            sources={x.sources}
            passages={x.passages}
            passagesLabel={x.passages?.length ? t('app.ask.passages') : undefined}
            notice={x.noticeKey ? t(x.noticeKey) : undefined}
            disclaimer={x.refining ? t('app.ask.refining') : t('app.ask.disclaimer')}
            placeholder={t('app.ask.placeholder')}
            submitLabel={t('app.ask.submit')}
            /* Only the newest panel carries the input — the log above is history. */
            value={i === log.length - 1 ? draft : undefined}
            onChange={i === log.length - 1 ? setDraft : undefined}
            onSubmit={i === log.length - 1 ? () => void ask() : undefined}
            busy={busy}
          />
        ))
      )}
    </section>
  );
}
