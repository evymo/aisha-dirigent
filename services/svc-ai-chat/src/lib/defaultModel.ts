/**
 * Default model resolution — there is NO baked model literal.
 *
 * AISHA chooses every model dynamically. The "default" — used only when a caller
 * has no explicit model and no tier/slot applies — is a LIVE resolve against the
 * serviceable pool via the one resolver (`aisha_resolve_clow_backend`), the same
 * path /v1, the critic loop and the reflection generator use. If the pool is empty
 * (no serviceable backend), this FAILS LOUD — there is no hardcoded fallback id
 * (the no-fallbacks rule: recovery = AISHA re-resolves, never a literal).
 *
 * `AISHA_DEFAULT_MODEL` / `AISHA_DEFAULT_LOCAL_MODEL` env literals are retired.
 *
 * @module
 */
import { rpcService } from "../postgrest.js";
import { selectServiceableSlugs, type LlmProvider } from "./llmRouter.js";
import { providerForResolvedBackend } from "./providerIdentity.js";

/** Volby výběru výchozího modelu — sdílené resolveDefaultModel i resolveDefaultBackend. */
export interface DefaultModelOptions {
  localOnly?: boolean;
  needsTools?: boolean;
  needsInternet?: boolean;
  maxCostUsd?: number;
  skipDeriveNeeds?: boolean;
}

/** Řádek, který resolver vydal jako `top` — čte se z něj model I jeho provider. */
interface ResolvedTop {
  model_id?: string;
  provider_slug?: string;
  backend_kind?: string;
}

/**
 * Resolve the default model for a purpose via AISHA's resolver, from the live
 * serviceable pool (the providers that actually hold a key). Throws when the pool
 * is empty or the resolver yields no model — never returns a hardcoded id.
 *
 * @param purpose short description of the call (helps the resolver's task ranking)
 * @param opts.localOnly force an on-prem backend (resolver §11 residency: cloud_forbidden)
 *   — used by the local/hybrid execution-mode tier floors so they resolve a LOCAL model.
 * @param opts.needsTools / opts.needsInternet capability hints (e.g. soulforge slots:
 *   ember→tools, webSearch→internet) so the resolver's capability gate applies.
 * @param opts.maxCostUsd cost ceiling → the resolver's cost_class (e.g. soulforge
 *   profiles: budget→0.3 → cheap 'budget' model, maxQuality→5 → 'premium').
 * @param opts.skipDeriveNeeds skip the advisory derive_clow_needs RPC when the caller
 *   already provides explicit needs (bounds RPC cost on fallback paths).
 */
export async function resolveDefaultModel(purpose = "chat", opts: DefaultModelOptions = {}): Promise<string> {
  const top = await resolveDefaultTop(purpose, opts);
  return top.model_id as string;
}

/**
 * Výchozí model I JEHO PROVIDER — oba z řádku, který vydal resolver.
 *
 * ⛔ NAMĚŘENO 2026-09-13: `resolveDefaultModel` vrací jen `top.model_id` a volající
 * (routes/chat.ts kompakce historie) providera dohadoval `resolveProvider(model)`
 * z prefixu — model id bez prefixu (alias lokálního modelu, model za llm_gateway)
 * odešel k `openai`. Kdo model rovnou dispatchuje, bere tuhle variantu.
 * Řádek, jehož providera proces neobsluhuje, je chyba — ne odhad.
 */
export async function resolveDefaultBackend(
  purpose = "chat",
  opts: DefaultModelOptions = {},
): Promise<{ model: string; provider: LlmProvider }> {
  const top = await resolveDefaultTop(purpose, opts);
  const provider = providerForResolvedBackend(top);
  if (!provider) {
    throw new Error(
      `[defaultModel] resolver vydal model "${top.model_id}" u providera "${top.provider_slug ?? ""}" ` +
        `(backend_kind "${top.backend_kind ?? ""}"), kterého tenhle proces neobsluhuje`,
    );
  }
  return { model: top.model_id as string, provider };
}

async function resolveDefaultTop(purpose: string, opts: DefaultModelOptions): Promise<ResolvedTop> {
  const serviceable = selectServiceableSlugs();
  if (serviceable.length === 0) {
    throw new Error(
      "[defaultModel] no serviceable backend configured — cannot resolve a default model " +
        "(configure a provider key, or pin a model on the caller)",
    );
  }
  let needs: Record<string, unknown> = {};
  if (!opts.skipDeriveNeeds) {
    try {
      needs =
        (await rpcService<Record<string, unknown>>("derive_clow_needs", {
          p_task: { description: purpose.slice(0, 200), task_kind: "chat" },
        })) ?? {};
    } catch {
      // derive_clow_needs is advisory — fall through with base clow if it fails.
    }
  }
  const res = await rpcService<{ resolved?: boolean; top?: ResolvedTop | null }>(
    "aisha_resolve_clow_backend",
    {
      p_clow: {
        purpose: purpose.slice(0, 200),
        task_kind: "chat",
        needs_write: needs.needs_write,
        needs_tools: opts.needsTools ?? needs.needs_tools,
        needs_internet: opts.needsInternet ?? needs.needs_internet,
        ...(opts.localOnly ? { cloud_forbidden: true } : {}),
        ...(opts.maxCostUsd != null ? { max_cost: opts.maxCostUsd } : {}),
      },
      p_context: { serviceable_slugs: serviceable },
    },
  );
  const top = res?.top;
  if (!top?.model_id) {
    throw new Error(
      `[defaultModel] aisha_resolve_clow_backend returned no serviceable ${opts.localOnly ? "local " : ""}chat model ` +
        "(pool empty or all backends unhealthy)",
    );
  }
  return top;
}
