/**
 * Model discovery — the headline of the dynamic-capability vision: "by available
 * keys/endpoints AISHA discovers which models exist; nothing is known in advance."
 *
 * Today ai_model_registry is STATIC-seeded and upsert_discovered_model is orphaned.
 * This wires the loop: for each backend that is actually configured (a backend is
 * registered only when its key/endpoint is present — createXBackend returns null
 * otherwise), read its live model list via healthCheck() and upsert each model into
 * the registry. Discovered models land with conservative capabilities
 * (is_chat_capable=true, eval_status='pending') — immediately usable as chat, with
 * detailed caps (reasoning/vision/…) refined by the self-test loop (PR-E), NOT a
 * hardcoded roster.
 *
 * The provider slug is normalized inside upsert_discovered_model (google→google-genai,
 * vllm→vllm-local), so we pass the backend's family id as p_provider.
 */
import { getAllBackends, isReasoningModel } from './llmRouter.js';

/** Minimal rpc surface — injected so this is unit-testable + auth-agnostic. */
export type DiscoveryRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export interface DiscoveryResult {
  discovered: number;
  perProvider: Record<string, number>;
  errors: Array<{ provider: string; error: string }>;
  /** Kolik modelů daného providera přestalo být dostupných (nejsou v jeho ÚPLNÉM listingu). */
  markedUnavailable: Record<string, number>;
  /**
   * Providery, jejichž dostupnost se v tomhle průchodu NEZMĚŘILA (backend
   * nedostupný nebo listing neúplný/stránkovaný). Jejich modely se nechávají být —
   * nezměřeno není „nic se neobsluhuje".
   */
  availabilityUnmeasured: string[];
  /** Změřené rozměry embedding modelů: `${provider}/${model}` → délka vektoru. */
  measuredEmbeddingDimensions: Record<string, number>;
}

/** Backend, jak ho discovery potřebuje — injektovatelný tvar (testy, jiné registry). */
export interface DiscoverableBackend {
  id: string;
  healthCheck(): Promise<{ available?: boolean; models?: string[]; modelsComplete?: boolean }>;
  embeddingDimension?(model: string): Promise<number>;
}

/** Tvar návratu `upsert_discovered_model`, který discovery čte. */
interface UpsertResult {
  is_new?: boolean;
  was_unavailable?: boolean;
  embedding_dimensions?: number | null;
}

/** Conservative capabilities derived from a model id at discovery time. */
export interface DerivedModelCaps {
  is_chat_capable: boolean;
  is_embedding: boolean;
  is_reasoning: boolean;
  is_vision: boolean;
  is_code_optimized: boolean;
  is_function_calling: boolean;
}

/**
 * Markers that identify a NON-chat model id (embedding / audio / image / legacy
 * completion). These are id-substring signals — capability-DERIVED, never a roster
 * of permitted names. Single source of truth, reused by both the discovery caps
 * derivation (modelDiscovery) and the /models/list filter (routes/models.ts), so
 * the two surfaces can never drift apart.
 */
export const NON_CHAT_MODEL_MARKERS = [
  'embedding', 'whisper', 'dall-e', 'tts', 'davinci', 'babbage', 'realtime', 'audio', 'moderation',
] as const;

/**
 * A model id is non-chat when it carries any non-chat marker (embedding/whisper/
 * tts/dall-e/realtime/audio/moderation/davinci/babbage). Derived from the id, the
 * only signal a health-probe model list carries — not an allow-list of names.
 */
export function isNonChatModelId(modelId: string): boolean {
  const m = modelId.toLowerCase();
  return NON_CHAT_MODEL_MARKERS.some((marker) => m.includes(marker));
}

/**
 * Derive a discovered model's capabilities from its id — the only signal a
 * health-probe model list carries (no rich metadata). DELIBERATELY conservative
 * + capability-DERIVED from naming patterns, never a hardcoded per-model roster:
 *   - chat: true UNLESS the id is a non-chat model (embedding/whisper/tts/dall-e/
 *     realtime/audio/moderation/davinci/babbage — isNonChatModelId, the same markers
 *     the /models/list filter uses). A discovered embedding/audio model must NOT be
 *     resolvable as chat (it would surface as a chat candidate and fail at dispatch).
 *   - embedding: id carries the `embedding` marker (text-embedding-3-*). Threaded to
 *     the registry so the embedding resolver (aisha_resolve_clow_backend task_kind=
 *     'embedding') can pick a discovered embedding model, symmetric with chat.
 *   - reasoning: reuses isReasoningModel (OpenAI o1/o3/o4/gpt-5) + cross-provider
 *     id markers (grok …-reasoning, gemini -thinking, claude opus/sonnet, deepseek-r).
 *   - vision: id markers shared across providers (vision / -o / 4o / grok-vision / -vl).
 *   - function_calling: assumed true for chat models (the modern default; OpenAI-
 *     compatible chat endpoints advertise tools) — refined by self-test.
 *   - code: explicit code-tuned id markers (coder / code / -codestral).
 * These flags only OPEN candidacy gates in aisha_resolve_clow_backend (needs_tools
 * ⇒ is_function_calling, needs_vision ⇒ is_vision); a wrong guess is corrected by
 * the self-test loop (PR-E), never strands the model (it stays chat-resolvable).
 */
export function deriveModelCaps(modelId: string): DerivedModelCaps {
  const m = modelId.toLowerCase();
  const isReasoning =
    isReasoningModel(modelId) ||
    /reasoning|thinking|deepseek-r|grok-[34]|o1|o3|o4/.test(m) ||
    /claude-(?:opus|sonnet)/.test(m);
  const isVision =
    /vision|-vl\b|-vl-|4o|4\.1|4-o|grok-(?:2-)?vision|gpt-5|gemini|claude-(?:opus|sonnet)|-o\b/.test(m);
  const isCode = /coder|-code\b|-code-|codestral/.test(m);
  const isEmbedding = m.includes('embedding');
  const isChat = !isNonChatModelId(modelId);
  return {
    is_chat_capable: isChat,
    is_embedding: isEmbedding,
    is_reasoning: isReasoning,
    is_vision: isVision,
    is_code_optimized: isCode,
    // Modern chat models expose tool/function calling by default; self-test refines.
    // Non-chat models (embeddings/audio) do not — keep function-calling tied to chat.
    is_function_calling: isChat,
  };
}

/**
 * Discover models across every CONFIGURED backend and upsert them into the registry.
 * Soft per-backend: one unreachable provider never blocks discovery of the others.
 */
export async function discoverModels(
  rpc: DiscoveryRpc,
  backends: ReadonlyArray<DiscoverableBackend> = getAllBackends(),
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    discovered: 0,
    perProvider: {},
    errors: [],
    markedUnavailable: {},
    availabilityUnmeasured: [],
    measuredEmbeddingDimensions: {},
  };

  for (const backend of backends) {
    try {
      const health = await backend.healthCheck();
      const models = (health.models ?? []).filter(Boolean);
      for (const modelId of models) {
        // Pass capability metadata so a discovered model is RESOLVABLE by
        // aisha_resolve_clow_backend's capability gates (needs_tools ⇒
        // is_function_calling, needs_vision ⇒ is_vision). chat=true default;
        // reasoning/vision/code DERIVED from the model id (deriveModelCaps).
        const caps = deriveModelCaps(modelId);
        const upserted = ((await rpc('upsert_discovered_model', {
          p_provider: backend.id,
          p_model_id: modelId,
          p_is_chat_capable: caps.is_chat_capable,
          p_is_embedding: caps.is_embedding,
          p_is_reasoning: caps.is_reasoning,
          p_is_vision: caps.is_vision,
          p_is_code_optimized: caps.is_code_optimized,
          p_is_function_calling: caps.is_function_calling,
        })) ?? {}) as UpsertResult;
        result.discovered += 1;
        result.perProvider[backend.id] = (result.perProvider[backend.id] ?? 0) + 1;

        await measureEmbeddingDimension(rpc, backend, modelId, caps, upserted, result);
      }

      // ⛔ NAMĚŘENO 2026-09-13: `mark_models_unavailable` nevolal NIKDO. Seedované
      // řádky vLLM (`Qwen/Qwen3-30B-A3B`, `Qwen/Qwen3-Embedding-4B`) proto zůstávaly
      // `is_available=true`, ačkoli je nic neobsluhovalo — resolver je nabízel
      // a dispatch končil 404 u lokálního serveru. Dostupnost je vlastnost ŽIVÉHO
      // listingu: co v úplném seznamu providera není, se neobsluhuje; co se v něm
      // znovu objeví, vrátí `upsert_discovered_model` zpět (is_available=true).
      //
      // Jen nad ÚPLNÝM listingem (HealthResult.modelsComplete). Nedostupný backend
      // nebo stránkovaný seznam dostupnost NEMĚŘÍ — tichý „nic tam není" by vyřadil
      // živé modely kvůli výpadku sondy („Tool failure ≠ data").
      if (health.available !== false && health.modelsComplete === true) {
        const marked = await rpc('mark_models_unavailable', {
          p_available_model_ids: models,
          p_provider: backend.id,
        });
        result.markedUnavailable[backend.id] = typeof marked === 'number' ? marked : 0;
      } else {
        result.availabilityUnmeasured.push(backend.id);
      }
    } catch (err) {
      result.errors.push({ provider: backend.id, error: String(err).slice(0, 200) });
      if (!result.availabilityUnmeasured.includes(backend.id)) result.availabilityUnmeasured.push(backend.id);
    }
  }

  return result;
}

/**
 * Perioda opakované discovery.
 *
 * ⛔ PROČ NESTAČÍ DISCOVERY PŘI STARTU: dostupnost je teď vlastnost živého
 * listingu, takže model se do registru vrací jen tehdy, když ho discovery
 * UVIDÍ. Cold-start přitom nasazuje svc-ai-chat dřív (jádro/ai-chat) než
 * svc-model (vlna 7, stahuje GGUF váhy) — boot scan lokální backend nezastihne
 * a bez dalšího průchodu by se objevený model k resolveru nedostal nikdy
 * (jen restartem nebo ručním /models/discover). Totéž po výpadku modelu.
 *
 * Časování, ne volba modelu: 15 min je řád, ve kterém se mění nasazení, ne
 * provoz. Jeden průchod na backend = jeden GET /v1/models; embedding sonda
 * běží jen při objevení (viz measureEmbeddingDimension).
 *
 * ⛔ C6 (2026-09-15): na tuhle periodu nesmí čekat nikdo, kdo o nasazení ví —
 * cold-start discovery vyžádá (POST /models/discover servisním tokenem, brána
 * lokalni-model-discovery-na-vyzadani). Perioda kryje nasazení jinými kanály
 * a návrat po výpadku; její hodnota změřená není (NEMĚŘENO).
 */
export const DISCOVERY_INTERVAL_MS = 15 * 60_000;

/**
 * Opakuj `task` po jeho DOKONČENÍ (ne podle hodin) — průchod s pomalou embedding
 * sondou se tak nikdy nepřekryje s dalším. Chyba průchodu smyčku nezastaví.
 * Časovač je `unref`, aby nedržel proces naživu.
 */
export function repeatAfterCompletion(
  task: () => Promise<void>,
  intervalMs: number,
  onError: (err: unknown) => void,
  timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout },
): { stop(): void } {
  let stopped = false;
  let handle: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (stopped) return;
    handle = timers.set(() => {
      void task()
        .catch(onError)
        .finally(schedule);
    }, intervalMs);
    (handle as { unref?: () => void }).unref?.();
  };
  schedule();
  return {
    stop() {
      stopped = true;
      if (handle !== undefined) timers.clear(handle);
    },
  };
}

/**
 * Změř rozměr embedding modelu a zapiš ho do registru — jednou za OBJEVENÍ.
 *
 * ⛔ Proč se měří: resolver prostoru (fn_resolve_embedding_model_for_space) páruje
 * model na sloupec podle rozměru (1024 → v1, 2560 → v2). Seed nesl rozměr jen jako
 * deklaraci k aliasu, který volí instance — pod týmž jménem může běžet jiný model.
 * S 1024 i 2560 modelem dostupnými současně pak jedna dráha padala až při zápisu.
 *
 * Kdy: model je nový, znovu se objevil (mohl se vyměnit build pod aliasem), nebo
 * rozměr v registru chybí. Ne při každém průchodu — CPU embedding je pomalý
 * (dokumentace compose uvádí > 80 s na vektor) a periodická discovery by ho
 * zbytečně vytěžovala. Selhání sondy je chyba v `errors`, nikdy rozměr.
 */
async function measureEmbeddingDimension(
  rpc: DiscoveryRpc,
  backend: DiscoverableBackend,
  modelId: string,
  caps: DerivedModelCaps,
  upserted: UpsertResult,
  result: DiscoveryResult,
): Promise<void> {
  if (!caps.is_embedding || typeof backend.embeddingDimension !== 'function') return;
  const due = upserted.is_new === true || upserted.was_unavailable === true || upserted.embedding_dimensions == null;
  if (!due) return;
  let dimensions: number;
  try {
    dimensions = await backend.embeddingDimension(modelId);
  } catch (err) {
    result.errors.push({ provider: backend.id, error: `embedding dimension ${modelId}: ${String(err).slice(0, 160)}` });
    return;
  }
  await rpc('upsert_discovered_model', {
    p_embedding_dimensions: dimensions,
    p_is_chat_capable: caps.is_chat_capable,
    p_is_code_optimized: caps.is_code_optimized,
    p_is_embedding: caps.is_embedding,
    p_is_function_calling: caps.is_function_calling,
    p_is_reasoning: caps.is_reasoning,
    p_is_vision: caps.is_vision,
    p_model_id: modelId,
    p_provider: backend.id,
  });
  result.measuredEmbeddingDimensions[`${backend.id}/${modelId}`] = dimensions;
}
