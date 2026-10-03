/**
 * Identita providera z ŘÁDKU REGISTRU — jediný domov převodu registr → LlmProvider.
 *
 * ⛔ NAMĚŘENO 2026-09-13: o provideru modelu rozhodovaly DVĚ pravdy. Self-test a benchmark
 * (PR #956) ho brali z řádku registru (`providerForRegistryRow`), kdežto dispatch nad
 * modelem, který vydal resolver (`aisha_resolve_clow_backend` → `top.provider_slug`,
 * `top.backend_kind`), ho na čtyřech místech HÁDAL z prefixu id přes `resolveProvider`:
 *   · llmRouter.ts reResolveExcluding   — `resolveProvider(top.model_id)`,
 *   · reflection/nodes/runtime_dispatch — `resolveProvider(backend.model_id)`,
 *   · criticLoop.ts backendToProvider   — direct_cloud → `resolveProvider(model_id)`,
 *   · routes/chat.ts kompakce historie  — `resolveProvider(await resolveDefaultModel(…))`,
 * a decision.ts mapBackendKindToProvider (vlastní kopie výčtu druhů a slugů) pro neznámý
 * slug direct_cloud taky — dnes na providerForResolvedBackend deleguje.
 * Model id bez prefixu (lokální alias, id modelu za llm_gateway `llmgateway-io`) tak
 * odešel k `openai` (nebo k `ollama`, když je nastavené OLLAMA_URL) — k providerovi,
 * který ho neobsluhuje.
 *
 * Tenhle modul je SCHVÁLNĚ bez závislostí na llmRouter za běhu (jen typ): testy uzlů
 * mockují `llmRouter.js` výčtem exportů, a převod identity se v nich musí chovat
 * skutečně, ne podle mocku.
 *
 * `resolveProvider(modelString)` v llmRouter.ts zůstává — výhradně pro RUČNĚ PSANÉ model
 * id bez řádku registru (tělo požadavku, override v konfiguraci uzlu, AISHA_SLOT_MODELS).
 * Brána `provider-z-registru-ne-z-prefixu` chytí jeho nové volání nad hodnotou z registru.
 */
import type { LlmProvider } from "./llmRouter.js";

/** LlmProvider → id backendu v registru @aisha/llm-dispatch. */
export const PROVIDER_TO_BACKEND_ID: Record<LlmProvider, string> = {
  openai: "openai",
  google: "google",
  anthropic: "anthropic",
  xai: "xai",
  vllm: "vllm",
  docker: "docker",
  ollama: "ollama",
  maestro: "maestro",
  // AISHA LLM Gateway — OpenAI-compatible self-hosted router. Used when
  // aisha_resolve_clow_backend picks backend_kind='llm_gateway' and the
  // generator passes `provider: 'gateway'` to unifiedChat.
  gateway: "gateway",
};

/**
 * ai_provider_registry slug for each backend id. A backend's id is the LlmProvider
 * family key; the registry addresses providers by `slug`, which differs for a few
 * (google→google-genai, vllm→vllm-local, ollama→ollama-local, gateway→llm-gateway).
 * Pure name normalization, NOT a roster.
 */
export const BACKEND_ID_TO_SLUG: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google-genai",
  xai: "xai",
  gateway: "llm-gateway",
  vllm: "vllm-local",
  ollama: "ollama-local",
  docker: "docker",
  maestro: "maestro",
};

/**
 * Provider, ZE KTERÉHO model pochází — přečtený z řádku registru, ne uhodnutý z id.
 *
 * `ai_model_registry.provider` nese rodinný klíč backendu (discovery ho zapisuje
 * jako `backend.id`: 'vllm', 'google', …); starší řádky a resolver nesou slug
 * (`vllm-local`, `google-genai`). Přijímají se oba tvary — čistá normalizace
 * jmen přes tutéž mapu, kterou používá `selectServiceableSlugs`, žádný seznam
 * povolených modelů.
 *
 * Neznámý klíč (např. 'mlx' — build, který na serveru spustit nelze) vrací
 * `null`: volající ho má přeskočit, ne poslat k providerovi odhadnutému z id.
 */
export function providerForRegistryRow(providerKey: string): LlmProvider | null {
  const key = providerKey.trim().toLowerCase();
  const knownIds = Object.keys(PROVIDER_TO_BACKEND_ID) as LlmProvider[];
  const byId = knownIds.find((id) => PROVIDER_TO_BACKEND_ID[id] === key);
  if (byId) return byId;
  const bySlug = knownIds.find((id) => BACKEND_ID_TO_SLUG[PROVIDER_TO_BACKEND_ID[id]] === key);
  return bySlug ?? null;
}

/** Tvar backendu, jak ho vrací resolver (`aisha_resolve_clow_backend` top / candidates). */
export interface RegistryBackendIdentity {
  provider_slug?: string | null;
  backend_kind?: string | null;
}

/**
 * Provider pro backend, který vydal RESOLVER — z jeho řádku registru.
 *
 * Pořadí: `backend_kind` transportu, který má v procesu jediný backend (llm_gateway →
 * gateway, local_vllm → vllm, local_ollama → ollama), potom slug/rodinný klíč
 * (`providerForRegistryRow`). decision.ts mapBackendKindToProvider na tuhle funkci deleguje.
 * Id modelu se NEČTE vůbec.
 *
 * `null` = řádek, který tenhle proces neumí obsloužit (slug bez backendu, např.
 * `mistral` z resolveru volaného bez `serviceable_slugs`). Volající selže nahlas nebo
 * kandidáta přeskočí — nikdy ho nepošle k providerovi odhadnutému z prefixu.
 */
export function providerForResolvedBackend(row: RegistryBackendIdentity | null | undefined): LlmProvider | null {
  if (!row) return null;
  const kind = (row.backend_kind ?? "").trim();
  if (kind === "llm_gateway") return "gateway";
  if (kind === "local_vllm") return "vllm";
  if (kind === "local_ollama") return "ollama";
  const slug = (row.provider_slug ?? "").trim();
  return slug ? providerForRegistryRow(slug) : null;
}
