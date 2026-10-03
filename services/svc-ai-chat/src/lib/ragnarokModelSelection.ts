/**
 * AISHA-governed model selection for Ragnarok/Insight RAG calls.
 *
 * AISHA's governing principle: EVERY model choice — including ragnarok's — is made
 * by the one resolver (`aisha_resolve_clow_backend`), per task, from the live
 * serviceable pool (providers that actually hold a key). ragnarok must NOT fall
 * back to its compose `DEFAULT_MODEL_*` — those silently bypass AISHA.
 *
 * ragnarok's `/nlp/rag/` endpoint already exposes a per-request `settings` override
 * (rag.py honors `settings.retrieval.model` + `settings.generation`), so the fix is
 * caller-side: resolve the embedding model AISHA wants for this retrieval, inject
 * only the model NAME, and keep `provider:"OpenAI"` = the OpenAI-compatible gateway
 * transport (the universal enactment that routes whatever model AISHA names to the
 * keyed provider). Generation is disabled here — ragnarok only retrieves chunks;
 * AISHA synthesizes through its own governed LLM path.
 *
 * Returns null when AISHA cannot serve an embedding model (no serviceable embedding
 * provider). The caller then SKIPS ragnarok enrichment — fail-loud, never a default.
 *
 * @module
 */
import { rpcService } from "../postgrest.js";
import { selectServiceableSlugs } from "./llmRouter.js";
import { createSafeLogger } from "@aisha/security";

const log = createSafeLogger("ragnarok-model-selection");

/**
 * Ragnarok AISettings subset we inject. `provider:"OpenAI"` is the gateway
 * transport (NOT the OpenAI vendor); `name` is AISHA's chosen model_id.
 */
export interface RagnarokRetrievalSettings {
  retrieval: { model: { provider: "OpenAI"; name: string } };
  generation: { enabled: false };
}

interface ResolverResult {
  resolved?: boolean;
  top?: { model_id?: string } | null;
}

/**
 * Resolve the embedding model AISHA selects for a retrieval task and shape it as a
 * ragnarok `settings` override. The same resolver + serviceable-slug truth the rest
 * of svc-ai-chat uses — no parallel selector.
 *
 * @returns the settings to inject, or null if AISHA can serve no embedding model
 *          (caller must then skip ragnarok rather than use a hardcoded default).
 */
export async function resolveRagnarokRetrievalSettings(opts: {
  query: string;
  storyId?: string | null;
  signal?: AbortSignal;
}): Promise<RagnarokRetrievalSettings | null> {
  try {
    const resolution = await rpcService<ResolverResult>(
      "aisha_resolve_clow_backend",
      {
        // task_kind='embedding' makes the resolver's capability gate pick an
        // is_embedding model — exactly "what" we're asking ragnarok to do.
        p_clow: {
          purpose: `embed retrieval query: ${opts.query}`.slice(0, 200),
          task_kind: "embedding",
        },
        p_context: {
          story_id: opts.storyId ?? null,
          // Live key-truth: the resolver only ranks providers we actually hold a
          // key for. Empty => unconstrained (e.g. discovery probe).
          serviceable_slugs: selectServiceableSlugs(),
        },
      },
      opts.signal ? { signal: opts.signal } : undefined,
    );

    const modelId = resolution?.top?.model_id;
    if (!resolution?.resolved || !modelId) {
      log.safeWarn(
        "[ragnarok] AISHA resolved no embedding model — skipping ragnarok enrichment (no default)",
        { resolved: resolution?.resolved ?? false },
      );
      return null;
    }

    return {
      retrieval: { model: { provider: "OpenAI", name: modelId } },
      generation: { enabled: false },
    };
  } catch (err) {
    log.safeWarn(
      "[ragnarok] embedding-model resolution failed — skipping ragnarok enrichment (no default)",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}
