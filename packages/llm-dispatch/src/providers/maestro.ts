/**
 * Maestro Backend — Alquist Insight dialog management as LLM provider adapter.
 *
 * Maestro is the multi-turn dialog management vrstvou Alquist Insight stacku,
 * která řídí coherence napříč obraty (Alexa Prize Socialbot Grand Challenge USP).
 * V AISHA stacku slouží jako LLM provider adapter — story-consult orchestrace
 * sestaví system prompt přes `compose_context` (Tao + Psyche + Hippocampus +
 * project + ruleset + kb_retrieval) a předá ho Maestrovi přes tento adapter.
 *
 * Maestro samo pak aplikuje multi-turn coherence techniky (reference resolution,
 * topic tracking, persona consistency) na assembled prompt.
 *
 * KRITICKÉ:
 * - Frontend NIKDY nesmí volat Maestro přímo (ani přes MCP /maestro/chat). Vždy
 *   přes `services/svc-ai-chat /story-consult`, jinak by se obešly Tao/Psyche/
 *   Hippocampus/governance vrstvy.
 * - `CONTEXT_ENABLED=true` v Maestro env je povinné — jinak je dialog state
 *   vypnutý = ztráta USP. Gate test insight-usp-integrity.gate.test.ts
 *   to kontroluje.
 *
 * Model name convention:
 *   `maestro-default`            → výchozí Maestro model
 *   `maestro-{project_id}`       → Maestro session vázaná na konkrétní project
 *                                  (typicky `story-{uuid}` pro per-story KB filter)
 *
 * @module
 */

import type {
  InferenceBackend,
  BackendKind,
  ChatRequest,
  ChatResponse,
  HealthResult,
} from "./types.js";
import { recordLlmCall } from "./metrics.js";

import { createSafeLogger } from '@aisha/security';
const log = createSafeLogger('svc-ai-chat');
// Per-instance mesh/public zones for the SSRF allowlist, derived from the deploy's
// own TLDs. MAESTRO_HOST_ALLOWLIST is an optional comma-separated extra list.
//
// NEDOSAZUJE SE ŽÁDNÝ LITERÁL — a u allowlistu to není formalita. Chybějící
// hodnota a dosazená hodnota tu míří na OPAČNÉ strany bezpečnosti: chybějící
// znamená „nikomu navíc nedůvěřuj", dosazená znamená „důvěřuj právě téhle
// doméně". Dřívější `MESH_TLD || "mesh.aisha.internal"` / `PUBLIC_TLD ||
// "aisha.guru"` proto každému nasazení BEZ těch proměnných rozšiřovalo
// allowlist o zóny jedné konkrétní instance — tedy o domény, které to nasazení
// nevlastní a nekontroluje.
//
// `aisha` NENÍ default, je to deklarovaná identita jedné instance (majitel,
// 2026-08-12): čte se stejně, jako by tam stálo jméno kteréhokoli jiného
// nájemníka. Když env chybí, zóna prostě v allowlistu není → fail-closed.
const MAESTRO_ALLOWED_SUFFIXES: readonly string[] = [
  ".docker.internal",
  ...[process.env.MESH_TLD, process.env.PUBLIC_TLD, ...(process.env.MAESTRO_HOST_ALLOWLIST?.split(",") ?? [])]
    .map((s) => s?.trim())
    // Prázdno vyhazujeme PŘED přilepením tečky: `.${""}` je "." a `host.endsWith(".")`
    // by prošlo každému FQDN zapsanému s koncovou tečkou ("evil.example.").
    .filter((s): s is string => Boolean(s))
    .map((s) => (s.startsWith(".") ? s : `.${s}`)),
];
/** Allow HTTPS or trusted local/mesh origins only (SSRF protection). */
function assertSafeMaestroUrl(url: string): void {
  if (url.startsWith("https://")) return;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "maestro" ||
      MAESTRO_ALLOWED_SUFFIXES.some((sfx) => host.endsWith(sfx))
    ) return;
  } catch {
    /* invalid URL — fall through */
  }
  throw new Error(`SSRF: Maestro URL must use HTTPS, localhost, mesh, or the instance mesh/public TLD, got ${url.substring(0, 80)}`);
}

/**
 * Extract project ID from model name. Convention:
 *   `maestro-default`        → "aisha" (default project)
 *   `maestro-story-{uuid}`   → "story-{uuid}"
 *   `maestro-sandbox-{uuid}` → "sandbox-{uuid}" (used by WF_SELF_LEARNING_LOOP)
 *   `maestro-{anything}`     → "{anything}"
 */
function extractProjectId(model: string): string {
  const m = model.toLowerCase();
  if (m === "maestro-default" || m === "maestro") return "aisha";
  if (m.startsWith("maestro-")) return model.slice("maestro-".length);
  return "aisha";
}

/**
 * Maestro inference backend.
 *
 * Maestro exposes `/projects/{project_id}/chat/` endpoint (Alquist Insight schema).
 * The `system_prompt` field MUST contain assembled AISHA context (Tao + Psyche +
 * Hippocampus + project + ruleset + kb_retrieval) — it is NOT built inside Maestro.
 */
export class MaestroBackend implements InferenceBackend {
  readonly id = "maestro";
  readonly label = "Maestro (Alquist Insight)";
  readonly kind: BackendKind = "cloud"; // remote service via mesh, treat as cloud
  readonly supportsTools = false; // Maestro nemá tool calling API
  readonly defaultTimeoutMs = 90_000; // dialog turny můžou být delší
  priority = 60;

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = (baseUrl ?? process.env.MAESTRO_URL ?? "").replace(/\/+$/, "");
    this.apiKey = apiKey ?? process.env.MAESTRO_API_KEY ?? "";
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: healthCheck
  // ---------------------------------------------------------------------------
  async healthCheck(): Promise<HealthResult> {
    if (!this.baseUrl || !this.apiKey) return { available: false };
    const url = `${this.baseUrl}/health`;
    try {
      assertSafeMaestroUrl(url);
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) };
    }
    const start = performance.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return { available: false };
      await res.body?.cancel();
      return { available: true, latencyMs: Math.round(performance.now() - start) };
    } catch (err) {
      log.safeWarn("[maestro] health check failed", { error: err instanceof Error ? err.message : String(err) });
      return { available: false };
    }
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: canServe
  // ---------------------------------------------------------------------------
  canServe(model: string): boolean {
    return model.toLowerCase().startsWith("maestro");
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: normalizeModel
  // ---------------------------------------------------------------------------
  normalizeModel(model: string): string {
    // Maestro neřeší model name interně — používá svůj backend (OpenAI nebo vLLM
    // dle INSIGHT_LLM_BACKEND env v Maestro containeru).
    return model;
  }

  // ---------------------------------------------------------------------------
  // InferenceBackend: chat — delegates to /projects/{id}/query/rag (RAG retrieval
  // + Maestro-internal LLM generation s session-aware multi-turn coherence).
  //
  // ARCHITEKTURA: Maestro API je `query/rag` (single-turn s server-side session
  // coherence přes session_id), NE `/chat/` s history v body. Multi-turn state
  // udržuje Maestro session — opakované volání se stejným session_id navazuje
  // na předchozí turny.
  //
  // System prompt (Tao+Psyche+Hippocampus assembled v svc-ai-chat) se Maestrovi
  // NEPŘEDÁVÁ — Maestro má vlastní interní system prompt configurovaný per
  // projekt. Pro AISHA cestu, kde brain layer MUSÍ ovlivnit final response,
  // story-consult.ts používá Maestro JEN pro retrieval (matched_chunks) a
  // generation dělá samostatným cloud LLM call s assembled brain prompt.
  //
  // Tj. tento adapter vrací Maestro generated_text (z interního Maestro LLM)
  // — vhodné pro debug / sandbox / service-role n8n agenty. Frontend story-consult
  // má jiný flow (provider adapter používaný JEN když je explicit `maestro-*`
  // model + nepotřebuje brain wiring).
  // ---------------------------------------------------------------------------
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.baseUrl) throw new Error("[maestro] MAESTRO_URL not configured");
    if (!this.apiKey) throw new Error("[maestro] MAESTRO_API_KEY not configured");

    const projectId = extractProjectId(request.model);

    // Last user message = current query (Maestro single-turn API).
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user");
    const query = lastUserMsg?.content ?? "";

    // session_id pro multi-turn coherence — caller může předat session přes
    // model name (`maestro-session-{uuid}`) nebo jako prefix v projectId.
    // Pro single-shot caller necháme Maestro vytvořit fresh session.
    const sessionMatch = request.model.match(/session-([a-zA-Z0-9-]+)/);
    const sessionParam = sessionMatch ? `?session_id=${encodeURIComponent(sessionMatch[1])}` : "";

    const url = `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/query/rag${sessionParam}`;
    assertSafeMaestroUrl(url);

    const body: Record<string, unknown> = {
      query,
      lang: process.env.INSIGHT_DEFAULT_LANG ?? "cs-CZ",
      return_matched_chunks: true,
      return_highlights: false,
      top_n_count: 5,
    };

    // Metrics: one aisha_llm_calls_total{provider,model,status} emission per
    // call. Defaults to 'error', flipped to 'ok' before a successful return.
    let status: "ok" | "error" = "error";
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.defaultTimeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "(empty)");
        throw new Error(
          `[maestro] API error (${response.status}): ${errorText.substring(0, 500)}`,
        );
      }

      const data = (await response.json()) as {
        answer?: string;
        generated_text?: string;
        response?: string;
        matched_chunks?: unknown[];
        session_id?: string;
        tokens_input?: number;
        tokens_output?: number;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const text =
        (typeof data.answer === "string" && data.answer) ||
        (typeof data.generated_text === "string" && data.generated_text) ||
        (typeof data.response === "string" && data.response) ||
        "";

      const inputTokens = data.tokens_input ?? data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.tokens_output ?? data.usage?.completion_tokens ?? 0;

      const result: ChatResponse = {
        text,
        usage: { inputTokens, outputTokens },
        backendId: this.id,
        model: request.model,
      };
      status = "ok";
      return result;
    } finally {
      recordLlmCall(this.id, request.model, status);
    }
  }
}

/** Create a Maestro backend from env. Returns null when MAESTRO_URL is not set. */
export function createMaestroBackend(): MaestroBackend | null {
  const url = process.env.MAESTRO_URL;
  const apiKey = process.env.MAESTRO_API_KEY;
  if (!url || !apiKey) return null;
  return new MaestroBackend(url, apiKey);
}
