import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyServiceRole } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { generateContextualPrefix, type PrefixResult } from '../lib/contextual-prefix.js';
import { resolveRagBackend, type ResolvedBackend } from '../lib/capability-resolver.js';
import { scanForInjection } from '../lib/ingestion-safety.js';
import {
  apiKeyForBackend,
  embedTextsSIdentitou,
  resolveEmbeddingBackendForSpace,
  type EmbeddingBackend,
} from '../lib/embed-query-in-space.js';
import { countTokens, EmbedDispatchError, type IdentitaVah } from '../lib/embed-dispatcher.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Strop délky jednoho embedovaného textu — přenesen z původního OpenAI klienta. */
const MAX_EMBED_CHARS = 8000;
const TARGET_CHUNK_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;
const MIN_CHUNK_CHARS = 100;
const MAX_BATCH_SIZE = 50;
/** v1 dopočet: strop dávky (dávka je sekvenční a hlídá ji i max_ms). */
const V1_BACKFILL_MAX_BATCH = 200;
/** Recept vstupu dopočtu — uložený chunk (+ případný kontextový prefix), bez shrnutí. */
const V1_BACKFILL_RECEPT = 'chunk_text_v1';
/** Kolik vektorů se změří, než se latence začne porovnávat s mediánem dávky. */
const V1_BACKFILL_ZAHRATI = 3;
/** Ústup: latence na token nad tímto násobkem mediánu dávky = souběh s dotazy uživatelů. */
const VYSTUP_NASOBEK = 3;
const CHARS_PER_TOKEN = 4;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChunkData {
  chunk_index: number;
  chunk_text: string;
  token_count: number;
  section_title: string | null;
  source_field: string;
}

// ─── Chunking Logic ──────────────────────────────────────────────────────────

function extractSectionTitle(text: string): string | null {
  const match = text.match(/^#{1,4}\s+(.+)$/m);
  if (match && text.indexOf(match[0]) < 200) return match[1].trim();
  return null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function findLastSentenceBreak(text: string, start: number, end: number): number {
  const segment = text.slice(start, end);
  for (let i = segment.length - 1; i >= 0; i--) {
    const ch = segment[i];
    if ((ch === '.' || ch === '?' || ch === '!') && i + 1 < segment.length) {
      const next = segment[i + 1];
      if (next === ' ' || next === '\n') return start + i + 1;
    }
  }
  return -1;
}

function chunkText(text: string, sourceField: string): ChunkData[] {
  if (!text || text.trim().length < MIN_CHUNK_CHARS) {
    if (text && text.trim().length > 0) {
      return [{
        chunk_index: 0,
        chunk_text: text.trim(),
        token_count: estimateTokens(text.trim()),
        section_title: extractSectionTitle(text.trim()),
        source_field: sourceField,
      }];
    }
    return [];
  }

  const chunks: ChunkData[] = [];
  let position = 0;
  let chunkIndex = 0;

  while (position < text.length) {
    const remaining = text.length - position;

    if (remaining <= TARGET_CHUNK_CHARS + CHUNK_OVERLAP_CHARS) {
      const ct = text.slice(position).trim();
      if (ct.length >= MIN_CHUNK_CHARS) {
        chunks.push({
          chunk_index: chunkIndex,
          chunk_text: ct,
          token_count: estimateTokens(ct),
          section_title: extractSectionTitle(ct),
          source_field: sourceField,
        });
      }
      break;
    }

    let end = position + TARGET_CHUNK_CHARS;
    const paragraphBreak = text.lastIndexOf('\n\n', end);
    if (paragraphBreak > position + TARGET_CHUNK_CHARS * 0.5) {
      end = paragraphBreak;
    } else {
      const sentenceBreak = findLastSentenceBreak(text, position, end);
      if (sentenceBreak > position + TARGET_CHUNK_CHARS * 0.3) {
        end = sentenceBreak;
      } else {
        const wordBreak = text.lastIndexOf(' ', end);
        if (wordBreak > position + TARGET_CHUNK_CHARS * 0.3) end = wordBreak;
      }
    }

    const chunkContent = text.slice(position, end).trim();
    if (chunkContent.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        chunk_index: chunkIndex,
        chunk_text: chunkContent,
        token_count: estimateTokens(chunkContent),
        section_title: extractSectionTitle(chunkContent),
        source_field: sourceField,
      });
      chunkIndex++;
    }

    const newPosition = end - CHUNK_OVERLAP_CHARS;
    position = Math.max(newPosition, position + MIN_CHUNK_CHARS);
  }

  return chunks;
}

function buildChunksForItem(item: {
  body_markdown: string;
  ai_instructions: string | null;
  title: string;
  summary: string | null;
}): ChunkData[] {
  const allChunks: ChunkData[] = [];

  const contextPrefix = [`# ${item.title}`, item.summary ? `\n${item.summary}` : '']
    .filter(Boolean)
    .join('\n');

  const bodyWithContext = contextPrefix
    ? `${contextPrefix}\n\n${item.body_markdown}`
    : item.body_markdown;

  allChunks.push(...chunkText(bodyWithContext, 'body'));

  if (item.ai_instructions && item.ai_instructions.trim().length >= MIN_CHUNK_CHARS) {
    const instrChunks = chunkText(item.ai_instructions, 'ai_instructions');
    const offset = allChunks.length;
    for (let i = 0; i < instrChunks.length; i++) {
      instrChunks[i].chunk_index = offset + i;
      allChunks.push(instrChunks[i]);
    }
  }

  return allChunks;
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * POST /embeddings/knowledge — Chunk knowledge_items and generate embeddings.
 * Pipeline: knowledge_items → knowledge_chunks → knowledge_embeddings.
 * Service-role only.
 */
/**
 * Vektorizace korpusu přes GOVERNANCE-vybraný backend.
 *
 * Vstup se zkracuje na `MAX_EMBED_CHARS` — týž strop, jaký měl původní
 * OpenAI klient. Není to kosmetika: přes limit vrací poskytovatel chybu a
 * spadla by celá dávka, tedy i chunky, které se vejdou.
 */
async function embedCorpus(
  texts: string[],
  backend: EmbeddingBackend,
): Promise<{ vectors: number[][]; identita: IdentitaVah | null }> {
  // Ingest korpusu = dávka (lane ji plánuje odděleně od interaktivních dotazů).
  return embedTextsSIdentitou(
    backend,
    texts.map((t) => (t.length > MAX_EMBED_CHARS ? t.slice(0, MAX_EMBED_CHARS) : t)),
    'davka',
  );
}

/**
 * Proveniencní značka vektoru: kdo ho spočítal a JAK byl model vybrán
 * (`<provider>:space_resolver:<prostor>`). Tvar `<provider>:<cesta>` zůstává.
 */
const modelVersionOf = (backend: EmbeddingBackend): string =>
  `${backend.provider_slug}:space_resolver:${backend.rag_space}`;

/**
 * Identita vektoru (E2): když backend poslal identitu vah (lane na GPU), je to ONA —
 * `<formát>:<sha256>;recipe=<recept>`, týž tvar, podle kterého fn_chunks_bez_zive_identity
 * pozná živý vektor. Bez ní zůstává proveniencní značka resolveru.
 */
const verzeVektoru = (backend: EmbeddingBackend, identita: IdentitaVah | null): string =>
  identita ? `${identita.identita};recipe=${identita.recept}` : modelVersionOf(backend);

export async function knowledgeEmbeddingsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      force?: boolean;
      batch_size?: number;
      item_type?: string;
      source_slug?: string;
      item_id?: string;
    };
  }>('/embeddings/knowledge', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized — service role required' });
    }

    const force = req.body?.force ?? false;
    const batchSize = Math.min(req.body?.batch_size ?? 10, MAX_BATCH_SIZE);

    // Fetch items needing processing via PostgREST RPC
    const items = await rpcService<Array<{
      id: string;
      title: string;
      summary: string | null;
      body_markdown: string;
      ai_instructions: string | null;
      source_slug: string | null;
      item_type: string;
      locale: string;
      source_hash: string | null;
    }>>('get_knowledge_items_for_embedding', {
      p_force: force,
      p_batch_size: batchSize,
      p_item_type: req.body?.item_type ?? null,
      p_source_slug: req.body?.source_slug ?? null,
      p_item_id: req.body?.item_id ?? null,
    });

    if (!items || items.length === 0) {
      return reply.send({
        message: 'No knowledge items found to process',
        processed: 0,
        results: [],
      });
    }

    // Kdo korpus vektorizuje, ROZHODUJE GOVERNANCE — týž resolver a týž účel
    // (`rag.embedding`) jako u v2 backfillu níž. Dřív tahle dráha volala
    // `generateEmbeddings()`, který má natvrdo `https://api.openai.com`: povolení
    // modelu se spravovalo v registru, ale korpus se stejně embedoval u cizího
    // poskytovatele — a texty smluv opouštěly instanci bez jediného rozhodnutí.
    // Rozlišení se řídí modelem, ne názvem sloupce: `insert_knowledge_embedding`
    // zapisuje do `embedding`, takže rozměr vydaný modelem musí sedět na tu dráhu;
    // nesedící rozměr Postgres odmítne (a je to tak správně — mlčky zkrácený
    // vektor je horší než chyba).
    // ⛔ NAMĚŘENO 2026-09-13: `resolveRagBackend('rag.embedding')` (CLOW resolver) rozměr
    // neřeší — s 1024 i 2560 modelem dostupnými mohl vydat 2560 pro tuhle v1 dráhu
    // a zápis by padl v DB. Sloupec `embedding` je prostor v1, takže model vybírá
    // TÝŽ resolver prostoru, jakým se embeduje dotaz (`embedQueryForProfile`) —
    // korpus a dotaz tak počítá model stejného prostoru. Resolve JEDNOU pro dávku.
    const corpusBackend = await resolveEmbeddingBackendForSpace('v1');
    if (!corpusBackend) {
      return reply.code(503).send({
        error: 'No embedding backend available for rag space v1',
        hint: 'fn_resolve_embedding_model_for_space(v1) nevrátil model: žádný dostupný is_embedding ' +
              'model s rozměrem prostoru v1 u povoleného zdravého providera. Discovery (svc-ai-chat) ' +
              'vede model jako dostupný, až ho uvidí v živém listingu a změří rozměr. Fail-closed ' +
              'záměrně: tichý pád na model jiného prostoru nebo na cloud by korpus poškodil či odeslal ven.',
      });
    }

    const results: Array<{
      source_slug: string | null;
      title: string;
      status: string;
      chunks_created?: number;
      embeddings_created?: number;
      prefixes_persisted?: number;
      error?: string;
    }> = [];

    let totalChunks = 0;
    let totalEmbeddings = 0;

    // Step 1 of retrieval optimization plan 2026: contextual prefix per chunk.
    // Set RAG_PREFIX_ENABLED=false to disable explicitly (then chunks embed raw —
    // an intentional operator opt-out). Otherwise the prefix is REQUIRED: we ask
    // the capability-resolver which backend AISHA has for rag.contextual_prefix,
    // and if none is healthy we FAIL LOUD (503) instead of silently embedding the
    // whole batch without prefixes. Recovery is health-driven — re-resolve on the
    // next run once a provider is healthy (no baked-in fallback).
    const prefixExplicitlyDisabled = (process.env.RAG_PREFIX_ENABLED ?? 'true').toLowerCase() === 'false';

    let prefixBackend: ResolvedBackend | null = null;
    if (!prefixExplicitlyDisabled) {
      prefixBackend = await resolveRagBackend('rag.contextual_prefix');
      if (!prefixBackend) {
        req.log.warn(
          { resolver_purpose: 'rag.contextual_prefix' },
          'no contextual-prefix backend healthy — failing loud (set RAG_PREFIX_ENABLED=false to embed without prefixes)',
        );
        return reply.code(503).send({
          error: 'No contextual-prefix backend available',
          hint: 'aisha_resolve_clow_backend returned no provider for rag.contextual_prefix. ' +
                'Enable a chat-capable provider (is_enabled) + run WF_PROVIDER_HEALTH_PROBE, ' +
                'or set RAG_PREFIX_ENABLED=false to embed without prefixes. Items are left ' +
                'unembedded and retried on the next run (no unprefixed embeddings written).',
        });
      }
      req.log.info(
        {
          resolved_provider: prefixBackend.provider_slug,
          resolved_model: prefixBackend.model_id,
          resolved_via: prefixBackend.resolved_via,
          health: prefixBackend.health_status,
        },
        'capability-resolver picked backend for rag.contextual_prefix',
      );
    }
    const prefixEnabled = !prefixExplicitlyDisabled && prefixBackend !== null;
    const prefixApiKey = prefixBackend?.auth_env_var
      ? process.env[prefixBackend.auth_env_var]
      : undefined;

    for (const item of items) {
      try {
        // ── Step 4: ingestion safety scan (BEFORE chunking + embedding) ──
        // Heuristic + LLM (capability-resolver rag.safety_scan) combine into
        // safety_score; status >= flagged → quarantined item is recorded via
        // fn_record_safety_scan_audited and skipped (no chunks, no embeddings).
        // Retrieval RPCs filter quarantined items separately (migration
        // 20260519020000_quarantine_retrieval_filter.sql).
        const scan = await scanForInjection({
          itemId: item.id,
          title: item.title,
          bodyMarkdown: item.body_markdown,
          aiInstructions: item.ai_instructions,
        });
        if (scan.status !== 'clear') {
          await rpcService('fn_record_safety_scan_audited', {
            p_item_id: item.id,
            p_metadata: scan.metadata,
            p_reason: scan.reason,
            p_score: scan.score,
            p_status: scan.status,
          });
          results.push({
            source_slug: item.source_slug,
            title: item.title,
            status: scan.status === 'quarantined' ? 'quarantined' : 'flagged',
            error: scan.reason,
          });
          continue;
        }

        const chunks = buildChunksForItem({
          body_markdown: item.body_markdown,
          ai_instructions: item.ai_instructions,
          title: item.title,
          summary: item.summary,
        });

        if (chunks.length === 0) {
          results.push({ source_slug: item.source_slug, title: item.title, status: 'skipped', error: 'No content to chunk' });
          continue;
        }

        // ── Phase A (Step 1): generate contextual prefix per chunk via LLM ──
        // Sequential — chunks per item are usually 1-20, vLLM concurrency is
        // bounded, and the latency hit is acceptable for batch ingestion. The
        // prefix is written in the item's locale (Brick4). Fail-loud: if a prefix
        // call throws, the item's catch marks it failed and we move on — the
        // embedding below is never reached, so no chunk embeds without its prefix.
        // prefixes[i] stays null ONLY when RAG_PREFIX_ENABLED=false (explicit opt-out).
        const prefixes: Array<PrefixResult | null> = new Array(chunks.length).fill(null);
        if (prefixEnabled && prefixBackend) {
          for (let i = 0; i < chunks.length; i++) {
            prefixes[i] = await generateContextualPrefix({
              item_title: item.title,
              item_body_markdown: item.body_markdown,
              section_title: chunks[i].section_title,
              chunk_text: chunks[i].chunk_text,
              locale: item.locale,
            }, {
              model: prefixBackend.model_id,
              model_version: `${prefixBackend.provider_slug}:${prefixBackend.resolved_via}`,
              base_url: prefixBackend.endpoint_url ?? undefined,
              api_key: prefixApiKey,
              auth_env_var: prefixBackend.auth_env_var,
              provider_slug: prefixBackend.provider_slug,
            });
          }
        }

        // ── Phase B: generate embeddings over (prefix + chunk_text) ──
        const embeddingInputs = chunks.map((c, i) => {
          const p = prefixes[i];
          return p ? `${p.prefix} ${c.chunk_text}` : c.chunk_text;
        });
        const { vectors: embeddings, identita: identitaKorpusu } = await embedCorpus(embeddingInputs, corpusBackend);

        // Clear existing if force — per-locale (Brick4): only this item's locale is
        // cleared, so re-ingesting one language never wipes its sibling locales.
        if (force) {
          await rpcService('clear_knowledge_item_chunks', { p_item_id: item.id, p_locale: item.locale });
        }

        // Insert chunks + embeddings via RPC
        let chunksInserted = 0;
        let embeddingsInserted = 0;
        let prefixesPersisted = 0;

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const chunkRow = await rpcService<{ id: string }>('insert_knowledge_chunk', {
            p_chunk_index: chunk.chunk_index,
            p_chunk_text: chunk.chunk_text,
            p_knowledge_item_id: item.id,
            // Brick4 locale axis: the chunk inherits its item's locale.
            p_locale: item.locale,
            p_section_title: chunk.section_title,
            p_source_field: chunk.source_field,
            p_token_count: chunk.token_count,
          });
          chunksInserted++;

          // Persist the prefix via the audited RPC. The embedding-invalidation
          // inside fn_enrich_chunk_context_audited is a no-op here (no
          // embedding inserted yet for this chunk_id) — the audit row still
          // gets written, which is what we want.
          const pr = prefixes[i];
          if (pr) {
            await rpcService('fn_enrich_chunk_context_audited', {
              p_chunk_id: chunkRow!.id,
              p_contextual_prefix: pr.prefix,
              p_model: pr.model,
              p_model_version: pr.model_version,
              p_token_count: pr.token_count,
            });
            prefixesPersisted++;
          }

          await rpcService('insert_knowledge_embedding', {
            p_chunk_id: chunkRow!.id,
            p_embedding: JSON.stringify(embeddings[i]),
            p_knowledge_item_id: item.id,
            // Brick4 locale axis: the embedding inherits its item's locale.
            p_locale: item.locale,
            // Identita vektoru je TA, která ho spočítala — ne konstanta ze souboru.
            // Jinak by se do jednoho prostoru daly namíchat vektory dvou modelů a
            // pořadí výsledků by tiše zhoršilo, bez jediné chyby v logu.
            p_model: corpusBackend.model_id,
            p_model_version: verzeVektoru(corpusBackend, identitaKorpusu),
          });
          embeddingsInserted++;
        }

        totalChunks += chunksInserted;
        totalEmbeddings += embeddingsInserted;

        results.push({
          source_slug: item.source_slug,
          title: item.title,
          status: 'success',
          chunks_created: chunksInserted,
          embeddings_created: embeddingsInserted,
          prefixes_persisted: prefixesPersisted,
        });
      } catch (err) {
        results.push({
          source_slug: item.source_slug,
          title: item.title,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'error').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    return reply.send({
      processed: items.length,
      succeeded,
      failed,
      skipped,
      total_chunks: totalChunks,
      total_embeddings: totalEmbeddings,
      results,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /embeddings/contextual-backfill — backfill prefixes for existing
  // chunks whose contextual_prefix IS NULL (Step 1 backfill path, called by
  // WF_CHUNK_CONTEXT_BACKFILL n8n workflow).
  //
  // For each chunk:
  //   1. fn_get_chunks_needing_context returns chunk + parent item context
  //   2. generateContextualPrefix calls vLLM
  //   3. fn_enrich_chunk_context_audited persists prefix + INVALIDATES
  //      existing embedding (so the next embedding refresh re-embeds with
  //      prefix as input)
  //
  // The embedding regeneration happens separately via the existing
  // /embeddings/knowledge route with force=true on the items, OR via
  // WF_EMBEDDING_REFRESH cron that picks up chunks with missing embeddings.
  // ---------------------------------------------------------------------------
  app.post<{
    Body: {
      batch_size?: number;
      item_id?: string;
    };
  }>('/embeddings/contextual-backfill', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized — service role required' });
    }

    const batchSize = Math.min(req.body?.batch_size ?? 20, MAX_BATCH_SIZE);
    const itemId = req.body?.item_id ?? null;

    interface ChunkNeedingContext {
      chunk_id: string;
      knowledge_item_id: string;
      chunk_index: number;
      chunk_text: string;
      item_title: string;
      item_body_markdown: string;
      section_title: string | null;
      locale: string;
    }

    let chunks: ChunkNeedingContext[];
    try {
      chunks = await rpcService<ChunkNeedingContext[]>('fn_get_chunks_needing_context', {
        p_batch_size: batchSize,
        p_item_id: itemId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: msg }, 'fn_get_chunks_needing_context failed');
      return reply.code(502).send({ error: 'Failed to fetch chunks', detail: msg });
    }

    if (!Array.isArray(chunks) || chunks.length === 0) {
      return reply.send({ processed: 0, enriched: 0, failed: 0, message: 'No chunks need contextual prefix' });
    }

    // Resolve backend once per backfill invocation (60s TTL inside resolver).
    const backfillBackend = await resolveRagBackend('rag.contextual_prefix');
    if (!backfillBackend) {
      return reply.code(503).send({
        error: 'No contextual-prefix backend available',
        hint: 'aisha_resolve_clow_backend returned no provider for rag.contextual_prefix (a chat task). ' +
              'Enable a chat-capable provider in ai_provider_registry (is_enabled) + run WF_PROVIDER_HEALTH_PROBE.',
      });
    }
    const backfillApiKey = backfillBackend.auth_env_var ? process.env[backfillBackend.auth_env_var] : undefined;

    let enriched = 0;
    let failed = 0;
    const failures: Array<{ chunk_id: string; reason: string }> = [];

    for (const chunk of chunks) {
      try {
        const result = await generateContextualPrefix({
          item_title: chunk.item_title,
          item_body_markdown: chunk.item_body_markdown,
          section_title: chunk.section_title,
          chunk_text: chunk.chunk_text,
          locale: chunk.locale,
        }, {
          model: backfillBackend.model_id,
          model_version: `${backfillBackend.provider_slug}:${backfillBackend.resolved_via}`,
          base_url: backfillBackend.endpoint_url ?? undefined,
          api_key: backfillApiKey,
          auth_env_var: backfillBackend.auth_env_var,
          // Bez slugu by nativní poskytovatel (google-genai, anthropic) šel
          // cestou /chat/completions — hlavní trasa ho předává, backfill ne.
          provider_slug: backfillBackend.provider_slug,
        });

        await rpcService('fn_enrich_chunk_context_audited', {
          p_chunk_id: chunk.chunk_id,
          p_contextual_prefix: result.prefix,
          p_model: result.model,
          p_model_version: result.model_version,
          p_token_count: result.token_count,
        });
        enriched += 1;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        req.log.warn({ chunk_id: chunk.chunk_id, reason }, 'contextual backfill row failed');
        failures.push({ chunk_id: chunk.chunk_id, reason });
        failed += 1;
      }
    }

    return reply.send({
      processed: chunks.length,
      enriched,
      failed,
      failures: failures.slice(0, 25),
    });
  });

  // ---------------------------------------------------------------------------
  // POST /embeddings/v2-backfill — populate the v2 (Qwen3 halfvec(2560)) embedding
  // space for chunks whose embedding_v2 is still NULL, using the resolver-chosen
  // embedding model. v2 is the multilingual migration target; the design audit found
  // the SQL write-side (fn_get_embeddings_needing_v2 + insert_knowledge_embedding_v2_*)
  // had NO runtime producer — this is it. Backend-agnostic via embed(); the model is a
  // per-context/corpus constant the resolver picks (same-model invariant), not per-chunk.
  // ---------------------------------------------------------------------------
  app.post<{
    Body: {
      batch_size?: number;
      item_id?: string;
    };
  }>('/embeddings/v2-backfill', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized — service role required' });
    }

    const batchSize = Math.min(req.body?.batch_size ?? 20, MAX_BATCH_SIZE);
    const itemId = req.body?.item_id ?? null;

    interface ChunkNeedingV2 {
      embedding_id: string;
      chunk_id: string;
      knowledge_item_id: string;
      chunk_text: string;
      contextual_prefix: string | null;
      locale: string;
    }

    let rows: ChunkNeedingV2[];
    try {
      rows = await rpcService<ChunkNeedingV2[]>('fn_get_embeddings_needing_v2', {
        p_batch_size: batchSize,
        p_item_id: itemId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: msg }, 'fn_get_embeddings_needing_v2 failed');
      return reply.code(502).send({ error: 'Failed to fetch chunks needing v2', detail: msg });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return reply.send({ processed: 0, generated: 0, failed: 0, message: 'No chunks need a v2 embedding' });
    }

    // Sloupec `embedding_v2` je prostor v2 — model vybírá resolver PROSTORU, ne CLOW
    // resolver, který rozměr neřeší (viz v1 dráha výš, naměřeno 2026-09-13). Jednou za dávku.
    const backend = await resolveEmbeddingBackendForSpace('v2');
    if (!backend) {
      return reply.code(503).send({
        error: 'No embedding backend available for rag space v2',
        hint: 'fn_resolve_embedding_model_for_space(v2) nevrátil model: žádný dostupný is_embedding ' +
              'model s rozměrem prostoru v2 u povoleného zdravého providera.',
      });
    }
    const modelVersion = modelVersionOf(backend);

    let generated = 0;
    let failed = 0;
    const failures: Array<{ chunk_id: string; reason: string }> = [];

    for (const row of rows) {
      try {
        // Contextual prefix (when present) is part of the embedded text — same input
        // shape as the v1 path, so the two spaces stay comparable.
        const text = row.contextual_prefix ? `${row.contextual_prefix} ${row.chunk_text}` : row.chunk_text;
        const {
          vectors: [vec],
          identita,
        } = await embedTextsSIdentitou(backend, [text], 'davka');
        if (!vec) {
          failures.push({ chunk_id: row.chunk_id, reason: 'embed returned no vector' });
          failed += 1;
          continue;
        }
        await rpcService('insert_knowledge_embedding_v2_audited', {
          p_chunk_id: row.chunk_id,
          p_embedding_v2: JSON.stringify(vec),
          // Brick4 locale axis: the v2 embedding inherits the chunk's locale
          // (surfaced by fn_get_embeddings_needing_v2).
          p_locale: row.locale,
          p_model: backend.model_id,
          p_model_version: identita ? verzeVektoru(backend, identita) : modelVersion,
        });
        generated += 1;
      } catch (err) {
        // Leave v2_status untouched on a per-row failure — the chunk stays a candidate.
        const reason = err instanceof Error ? err.message : String(err);
        req.log.warn({ chunk_id: row.chunk_id, reason }, 'v2 backfill row failed');
        failures.push({ chunk_id: row.chunk_id, reason });
        failed += 1;
      }
    }

    return reply.send({
      processed: rows.length,
      generated,
      failed,
      model: backend.model_id,
      via: 'space_resolver',
      failures: failures.slice(0, 25),
    });
  });

  // ── POST /embeddings/v1-backfill — platformní dopočet vektorů ŽIVÉ identity ──────────
  // Rozhodnutí majitele 2026-09-29: staré vektory (sentence-transformers, MLX, žádné)
  // přepočítat „samo na serveru". Chunky BEZ vektoru živé identity (fn_get_chunks_needing_v1 →
  // fn_ziva_identita_v1: model resolveru v1 + deklarovaná identita vah `<formát>:<sha>`) kóduje TÝŽ svc-model, kterým se
  // kódují dotazy — identita strany dotazů z definice. Bez přechunkování a bez LLM prefixu:
  // vstup = uložený chunk (recept `chunk_text_v1`, zapsaný do model_version, aby šlo poznat,
  // co přepočítat, kdyby se recept změnil). Přepis NA MÍSTĚ (ON CONFLICT (chunk_id, locale)).
  //
  // ⛔ Tichý ořez: llama.cpp kóduje nejvýš n_batch tokenů a delší vstup ořízne BEZ chyby
  // (naměřeno na riq 2026-09-29: 8,2 % chunků přes 512). Každý text se proto nejdřív
  // spočítá tokenizérem svc-model (/extras/tokenize/count); nad declared.max_tokens se
  // NEKÓDUJE — zapíše se do knowledge_embedding_vynechani (nad_limitem), aby frontu neucpal.
  //
  // svc-model obsluhuje i dotazy uživatelů (MODEL_N_THREADS=2): dávka jede po JEDNOM textu
  // a USTOUPÍ, když latence na token vzroste nad VYSTUP_NASOBEK × medián dávky (souběh
  // s dotazy), nebo když vyprší max_ms. Postup je vidět ze serveru (pokrytí vektory
  // v brokeru, metadata.pokryti_vektoru), ne z historie plánovače.
  //
  // ⛔ P2 (NAMĚŘENO 2026-10-06, riq): jedno volání zpracovalo JEDNU dávku (≤ 200 chunků) a skončilo
  // „hotovo“ — při 193 028 úsecích a plánovači */10 v noci ≈ 12k za noc, tedy ~16 nocí. Teď volání
  // bere dávky ve SMYČCE, dokud fronta nevyschne nebo nevyprší časový rozpočet (max_ms) — a dál
  // respektuje každý stop: kvóta nájemce na lane (KVOTA_PREKROCENA, kontrakt Infra 5607e6840),
  // ústup při souběhu s dotazy, tokenizace nedostupná, cizí identita vah. Dávka bez postupu (jen
  // selhání) smyčku zastaví (`bez_postupu`), aby se volání netočilo nad týmiž vadnými řádky.
  // Idempotentní: fronta (fn_get_chunks_needing_v1) vrací jen chunky BEZ vektoru živé identity
  // a chunk, který toto volání už zkusilo, se v něm podruhé nezkouší. Přepis na místě (ON CONFLICT)
  // nastane až po úspěšném vektoru ověřené identity — starý vektor se předem nemaže; během přepočtu
  // hledání (v3) srovnává jen s vektory deklarované identity, takže se generace nemíchají.
  app.post<{
    Body: {
      batch_size?: number;
      max_ms?: number;
    };
  }>('/embeddings/v1-backfill', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized — service role required' });
    }
    // n8n posílá parametry těla jako řetězce — převést výslovně, nespoléhat na koerci.
    const batchSize = Math.max(1, Math.min(Number(req.body?.batch_size ?? 20) || 20, V1_BACKFILL_MAX_BATCH));
    const maxMs = Math.max(1000, Math.min(Number(req.body?.max_ms ?? 120_000) || 120_000, 600_000));
    const t0 = Date.now();

    const backend = await resolveEmbeddingBackendForSpace('v1');
    if (!backend) {
      return reply.code(503).send({
        error: 'No embedding backend available for rag space v1',
        hint: 'fn_resolve_embedding_model_for_space(v1) nevrátil model — dopočet nemá čím kódovat (fail-closed).',
      });
    }
    interface ChunkNeedingV1 {
      chunk_id: string;
      knowledge_item_id: string;
      chunk_text: string;
      contextual_prefix: string | null;
      locale: string;
      model_id: string;
      identita: string;
      max_tokens: number;
    }
    /** Jedna dávka z fronty — jen chunky BEZ vektoru živé identity (idempotentní výběr). */
    const nactiDavku = () => rpcService<ChunkNeedingV1[]>('fn_get_chunks_needing_v1', { p_batch_size: batchSize });
    let rows: ChunkNeedingV1[];
    try {
      rows = await nactiDavku();
    } catch (err) {
      // Typicky „živá identita neznámá" (chybí declared pin nebo formát; zpráva nese návod) — nahlas, ne prázdná dávka.
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: msg }, 'fn_get_chunks_needing_v1 failed');
      return reply.code(502).send({ error: 'Failed to fetch chunks needing v1', detail: msg });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return reply.send({ processed: 0, generated: 0, nad_limitem: 0, failed: 0, davek: 0, konec: 'hotovo',
        message: 'Všechny chunky mají vektor živé identity (nebo jsou záměrně vynechané)' });
    }
    if (rows.some((r) => r.model_id !== backend.model_id)) {
      // Resolver vydal jiný model než SQL — závod s přepnutím modelu; nic nezapisovat.
      return reply.code(409).send({ error: 'Model resolveru se změnil během dávky', resolver: backend.model_id });
    }
    let pocitadloUrl: string;
    try {
      pocitadloUrl = new URL('/extras/tokenize/count', backend.endpoint_url ?? '').toString();
    } catch {
      return reply.code(503).send({ error: 'Embedding backend nemá endpoint_url — nelze spočítat tokeny (fail-closed)' });
    }

    let generated = 0;
    let nadLimitem = 0;
    let failed = 0;
    let konec:
      | 'hotovo' | 'casovy_limit' | 'ustoupeno' | 'tokenizace_nedostupna' | 'identita_nesouhlasi' | 'kvota'
      | 'bez_postupu' | 'vyber_selhal' | 'identita_zmenena' = 'hotovo';
    // Kvóta nájemce na lane (KVOTA_PREKROCENA) platí pro celé okno: další řádky by dostaly
    // totéž odmítnutí. Dávka proto KONČÍ (nic se nepočítá jako selhání) a pohon zkusí znovu.
    let kvota: { druh: string | null; retry_after_s: number | null } | null = null;
    const jeKvota = (err: unknown): err is EmbedDispatchError =>
      err instanceof EmbedDispatchError && err.duvod === 'KVOTA_PREKROCENA';
    const latencePerToken: number[] = [];
    // Lane na GPU počítadlo tokenů nemá (CESTA_NEZNAMA) a vstup nad oknem odmítne kódem
    // ENGINE_ODMITL — po prvním takovém zjištění se předpočet přeskakuje.
    let laneBezPocitadla = false;
    const failures: Array<{ chunk_id: string; reason: string }> = [];
    // Identita a model první dávky platí pro celé volání; jiná v další dávce = přepnutí během běhu.
    const identita = rows[0]?.identita ?? null;
    // Chunky, které toto volání už zkusilo — podruhé se nezkoušejí (selhaný řádek fronta vrátí znovu).
    const zkusene = new Set<string>();
    let davek = 0;

    for (;;) {
      const nove = rows.filter((r) => !zkusene.has(r.chunk_id));
      if (nove.length === 0) {
        konec = 'bez_postupu';
        break;
      }
      davek += 1;
      const postupPred = generated + nadLimitem;
      for (const row of nove) {
        zkusene.add(row.chunk_id);
        if (Date.now() - t0 > maxMs) {
          konec = 'casovy_limit';
          break;
        }
        const text = row.contextual_prefix ? `${row.contextual_prefix} ${row.chunk_text}` : row.chunk_text;
        let tokenu: number | null = null;
        if (!laneBezPocitadla) {
          try {
            tokenu = await countTokens(pocitadloUrl, backend.model_id, text, undefined, {
              apiKey: await apiKeyForBackend(backend),
              trida: 'davka',
            });
          } catch (err) {
            if (jeKvota(err)) {
              kvota = { druh: err.kvota ?? null, retry_after_s: err.znovuZaS };
              konec = 'kvota';
              break;
            }
            if (err instanceof EmbedDispatchError && err.duvod === 'CESTA_NEZNAMA') {
              // Lane počítadlo NEMÁ a vstup NEOŘEZÁVÁ (E3): nad oknem odmítne ENGINE_ODMITL.
              // Rozhodne tedy odpověď lane — kód protokolu, ne odhad.
              laneBezPocitadla = true;
            } else {
              // Bez počtu tokenů nelze vyloučit tichý ořez → nekódovat nic dalšího.
              req.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'v1 backfill: tokenizace nedostupná');
              konec = 'tokenizace_nedostupna';
              break;
            }
          }
        }
        try {
          if (tokenu !== null && tokenu > row.max_tokens) {
            await rpcService('fn_record_embedding_vynechani', {
              p_chunk_id: row.chunk_id,
              p_duvod: 'nad_limitem',
              p_identita: row.identita,
              p_locale: row.locale,
              p_tokenu: tokenu,
            });
            nadLimitem += 1;
            continue;
          }
          const t1 = Date.now();
          let vysledek: { vectors: number[][]; identita: IdentitaVah | null };
          try {
            vysledek = await embedTextsSIdentitou(backend, [text], 'davka');
          } catch (err) {
            if (jeKvota(err)) {
              kvota = { druh: err.kvota ?? null, retry_after_s: err.znovuZaS };
              konec = 'kvota';
              break;
            }
            if (err instanceof EmbedDispatchError && err.duvod === 'ENGINE_ODMITL') {
              // Lane odmítla vstup nad oknem (E3) — týž stav jako „nad limitem“ z počítadla.
              await rpcService('fn_record_embedding_vynechani', {
                p_chunk_id: row.chunk_id,
                p_duvod: 'nad_limitem',
                p_identita: row.identita,
                p_locale: row.locale,
                p_tokenu: null,
              });
              nadLimitem += 1;
              continue;
            }
            throw err;
          }
          const [vec] = vysledek.vectors;
          if (vysledek.identita && vysledek.identita.identita !== row.identita) {
            // F5/R5c: vektor spočítaly JINÉ váhy, než instance deklaruje — neukládat a zastavit
            // dávku (další vektory by byly z téhož cizího prostoru).
            failures.push({
              chunk_id: row.chunk_id,
              reason: `identita vah ${vysledek.identita.identita} ≠ deklarovaná ${row.identita} — vektor neuložen`,
            });
            failed += 1;
            konec = 'identita_nesouhlasi';
            break;
          }
          const perToken = (Date.now() - t1) / Math.max(tokenu ?? 1, 1);
          if (!vec) {
            failures.push({ chunk_id: row.chunk_id, reason: 'embed returned no vector' });
            failed += 1;
            continue;
          }
          await rpcService('insert_knowledge_embedding', {
            p_chunk_id: row.chunk_id,
            p_embedding: JSON.stringify(vec),
            p_knowledge_item_id: row.knowledge_item_id,
            p_locale: row.locale,
            p_model: row.model_id,
            p_model_version: `${row.identita};recipe=${V1_BACKFILL_RECEPT}`,
          });
          generated += 1;
          const median = medianOf(latencePerToken);
          latencePerToken.push(perToken);
          // Spodní mez 1 ms/token: medián blízko nuly (velmi rychlá volání) by jinak
          // bral jako souběh i běžný šum. Reálný svc-model má ~15–20 ms/token.
          if (latencePerToken.length > V1_BACKFILL_ZAHRATI && median !== null
              && perToken > VYSTUP_NASOBEK * Math.max(median, 1)) {
            konec = 'ustoupeno';
            break;
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          req.log.warn({ chunk_id: row.chunk_id, reason }, 'v1 backfill row failed');
          failures.push({ chunk_id: row.chunk_id, reason });
          failed += 1;
        }
      }
      // Postup je vidět i v logu služby (dávka po dávce), nejen v souhrnu odpovědi.
      req.log.info({ davka: davek, generated, nad_limitem: nadLimitem, failed, konec, ms: Date.now() - t0 }, 'v1 backfill: dávka');
      if (konec !== 'hotovo') break; // stop z dávky: kvóta, ústup, čas, tokenizace, cizí identita
      if (generated + nadLimitem === postupPred) {
        konec = 'bez_postupu';
        break;
      }
      if (Date.now() - t0 > maxMs) {
        konec = 'casovy_limit';
        break;
      }
      try {
        rows = await nactiDavku();
      } catch (err) {
        req.log.error({ err: err instanceof Error ? err.message : String(err) }, 'v1 backfill: další dávka se nenačetla');
        konec = 'vyber_selhal';
        break;
      }
      if (!Array.isArray(rows) || rows.length === 0) break; // fronta vyschla → hotovo
      if (rows.some((r) => r.model_id !== backend.model_id || r.identita !== identita)) {
        // Deklarace nebo resolver se během běhu změnily — nic dalšího nepsat pod starou identitou.
        konec = 'identita_zmenena';
        break;
      }
    }

    return reply.send({
      processed: generated + nadLimitem + failed,
      generated,
      nad_limitem: nadLimitem,
      failed,
      davek,
      konec,
      kvota,
      identita,
      model: backend.model_id,
      recept: V1_BACKFILL_RECEPT,
      ms: Date.now() - t0,
      failures: failures.slice(0, 25),
    });
  });
}

function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}
