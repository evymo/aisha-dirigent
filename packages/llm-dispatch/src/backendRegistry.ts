/**
 * Backend Registry — Runtime discovery, health, and fallback management.
 *
 * Singleton that discovers available inference backends from env vars,
 * caches health probe results, and provides ordered backend lists for
 * the router to iterate through with fallback support.
 *
 * Architectural principle: **all backends are identical, swappable
 * resources** — the only difference is availability and configuration.
 *
 * @module
 */

import type { InferenceBackend, HealthResult } from "./providers/types.js";
import { getExecutionMode } from "./executionMode.js";
import { createOpenAIBackend } from "./providers/openai.js";
import { createGeminiBackend } from "./providers/gemini.js";
import { createAnthropicBackend } from "./providers/anthropic.js";
import {
  createOllamaBackend,
  createDockerBackend,
  createVLLMBackend,
  createGatewayBackend,
  createXAIBackend,
} from "./providers/openai-compat.js";
import { createMaestroBackend } from "./providers/maestro.js";

// =============================================================================
// Circuit Breaker
// =============================================================================

interface CircuitState {
  failures: number;
  lastFailureAt: number;
  state: "closed" | "open" | "half-open";
  openedAt: number;
}

/** Open circuit after this many failures. */
const CIRCUIT_FAILURE_THRESHOLD = 3;
/** How long to keep circuit open (ms). */
const CIRCUIT_OPEN_DURATION_MS = 60_000;
/** Failure window — only count failures within this period (ms). */
const CIRCUIT_FAILURE_WINDOW_MS = 5 * 60_000;

// =============================================================================
// Health Cache
// =============================================================================

interface CachedHealth {
  result: HealthResult;
  timestamp: number;
}

/** Health cache TTL for local backends (ms). */
const LOCAL_HEALTH_TTL_MS = 60_000;
/** Health cache TTL for cloud backends (ms). */
const CLOUD_HEALTH_TTL_MS = 300_000;

// =============================================================================
// Backend Registry
// =============================================================================

/**
 * Runtime backend registry.
 *
 * Discovers backends from environment, probes their health,
 * and provides ordered lists for fallback routing.
 */
/**
 * REZIDENCE DAT = SCHOPNOST, NE FILTR (2026-09-28).
 *
 * V režimu `AISHA_EXECUTION_MODE=local` smí požadavek i data zůstat JEN na
 * lokálních backendech (instance si to deklaruje — RIQ: model uvnitř meshe).
 * `resolveBackends` cloud v local režimu vynechával, ale kolem něj vedou cesty,
 * které berou backend přímo z `getAllBackends()`: připíchnutý provider
 * (`pinProvider`), gateway, záložní hledání podle id providera, přepadnutí na
 * jiného kandidáta po selhání (re-resolve) i stream. Stačilo, aby cloudový klíč
 * byl v prostředí, a kterákoli z nich poslala otázku ven.
 *
 * Proto registr v local režimu cloudový backend VŮBEC NEZAREGISTRUJE (ani přes
 * `addBackend`): co v registru není, to žádná cesta nezavolá. Odmítnutí se
 * hlásí nahlas — tiché zmizení backendu by vypadalo jako chybějící klíč.
 */
function residencyAllows(backend: InferenceBackend): boolean {
  if (getExecutionMode() === "local" && backend.kind === "cloud") {
    console.warn(
      `[llm-dispatch] AISHA_EXECUTION_MODE=local: cloudový backend "${backend.id}" se neregistruje ` +
        `(data zůstávají na lokálních backendech).`,
    );
    return false;
  }
  return true;
}

export class BackendRegistry {
  private backends: InferenceBackend[] = [];
  private healthCache: Map<string, CachedHealth> = new Map();
  private circuits: Map<string, CircuitState> = new Map();
  private initialized = false;

  // ---------------------------------------------------------------------------
  // Initialization — discover backends from environment
  // ---------------------------------------------------------------------------

  /**
   * Discover and register all configured backends.
   * Safe to call multiple times — backends are only discovered once.
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    const factories: Array<() => InferenceBackend | null> = [
      createOpenAIBackend,
      createGeminiBackend,
      createAnthropicBackend,
      // xAI (Grok) — OpenAI-compatible direct cloud. Registered only when
      // XAI_API_KEY is present (createXAIBackend returns null otherwise), so
      // its slug surfaces in selectServiceableSlugs() — and thus becomes a
      // resolver candidate — exactly when this process holds the key.
      createXAIBackend,
      createOllamaBackend,
      createDockerBackend,
      createVLLMBackend,
      createMaestroBackend,
      // AISHA LLM Gateway — selectable by aisha_resolve_clow_backend when
      // backend_kind='llm_gateway' wins the score (e.g. tasks where free
      // Langfuse observability outweighs the ~10ms gateway hop). Not
      // reached via prefix-match (modelPrefixes=[]) — only via explicit
      // provider='gateway' from generator.ts honoring state.clow_backend.
      createGatewayBackend,
    ];

    for (const factory of factories) {
      const backend = factory();
      if (backend && residencyAllows(backend)) {
        this.backends.push(backend);
      }
    }
  }

  /**
   * Register an additional backend (e.g. from DB ai_model_registry).
   * Rezidence platí i tady: v režimu `local` se cloudový backend nepřidá.
   */
  addBackend(backend: InferenceBackend): void {
    // Avoid duplicates
    if (this.backends.some((b) => b.id === backend.id)) return;
    if (!residencyAllows(backend)) return;
    this.backends.push(backend);
  }

  /**
   * Get all registered backends (regardless of health).
   */
  getAllBackends(): readonly InferenceBackend[] {
    this.initialize();
    return this.backends;
  }

  /**
   * The model ids THIS process has DISCOVERED for a backend — the in-memory truth
   * cached by the last health probe / model-discovery pass (A1: cloud backends
   * self-load `/v1/models`; openai-compat backends populate `HealthResult.models`).
   * Sync + side-effect-free: reads only the existing health cache, never probes.
   *
   * This is the capability-availability source for the proactive remap
   * (`resolveAvailableModel`) — a backend's representative model is DERIVED from
   * what it actually serves, never a hardcoded per-provider roster. Empty when no
   * probe has run yet (cold process); the caller then keeps the preferred model so
   * the downstream surfaces a clear error rather than a silent swap.
   */
  getDiscoveredModels(backendId: string): readonly string[] {
    const cached = this.healthCache.get(backendId);
    return cached?.result.models ?? [];
  }

  // ---------------------------------------------------------------------------
  // Health Checks
  // ---------------------------------------------------------------------------

  /**
   * Check if a specific backend's health is cached and fresh.
   */
  private getCachedHealth(backend: InferenceBackend): HealthResult | null {
    const cached = this.healthCache.get(backend.id);
    if (!cached) return null;
    const ttl = backend.kind === "local" ? LOCAL_HEALTH_TTL_MS : CLOUD_HEALTH_TTL_MS;
    if (Date.now() - cached.timestamp > ttl) return null;
    return cached.result;
  }

  /**
   * Probe a backend's health (cached with TTL).
   */
  async checkHealth(backend: InferenceBackend): Promise<HealthResult> {
    const cached = this.getCachedHealth(backend);
    if (cached) return cached;

    try {
      const result = await backend.healthCheck();
      this.healthCache.set(backend.id, { result, timestamp: Date.now() });
      return result;
    } catch (err) {
      const failResult: HealthResult = {
        available: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      this.healthCache.set(backend.id, { result: failResult, timestamp: Date.now() });
      return failResult;
    }
  }

  /**
   * Check if at least one backend is available.
   */
  async hasAnyAvailableBackend(): Promise<boolean> {
    this.initialize();
    for (const backend of this.backends) {
      const health = await this.checkHealth(backend);
      if (health.available && this.isCircuitClosed(backend.id)) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Circuit Breaker
  // ---------------------------------------------------------------------------

  private getCircuit(backendId: string): CircuitState {
    let circuit = this.circuits.get(backendId);
    if (!circuit) {
      circuit = { failures: 0, lastFailureAt: 0, state: "closed", openedAt: 0 };
      this.circuits.set(backendId, circuit);
    }
    return circuit;
  }

  /**
   * Check if a backend's circuit is closed (or half-open and ready to try).
   */
  isCircuitClosed(backendId: string): boolean {
    const circuit = this.getCircuit(backendId);
    if (circuit.state === "closed") return true;
    if (circuit.state === "open") {
      // Check if enough time has passed to transition to half-open
      if (Date.now() - circuit.openedAt >= CIRCUIT_OPEN_DURATION_MS) {
        circuit.state = "half-open";
        return true;
      }
      return false;
    }
    // half-open — allow one try
    return true;
  }

  /**
   * Record a successful request to a backend.
   */
  recordSuccess(backendId: string): void {
    const circuit = this.getCircuit(backendId);
    if (circuit.state === "half-open") {
      // Half-open → success → close circuit
      circuit.state = "closed";
      circuit.failures = 0;
    }
  }

  /**
   * Record a failed request to a backend.
   */
  recordFailure(backendId: string): void {
    const circuit = this.getCircuit(backendId);
    const now = Date.now();

    // Only count recent failures
    if (now - circuit.lastFailureAt > CIRCUIT_FAILURE_WINDOW_MS) {
      circuit.failures = 0;
    }

    circuit.failures++;
    circuit.lastFailureAt = now;

    if (circuit.state === "half-open") {
      // Half-open → failure → reopen
      circuit.state = "open";
      circuit.openedAt = now;
    } else if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuit.state = "open";
      circuit.openedAt = now;
    }
  }

  // ---------------------------------------------------------------------------
  // Model → Backend Resolution
  // ---------------------------------------------------------------------------

  /**
   * Find all backends that can serve a given model, ordered by priority.
   * Filters out unhealthy backends, open circuits, and backends excluded
   * by the current execution mode (AISHA_EXECUTION_MODE).
   */
  async resolveBackends(model: string): Promise<InferenceBackend[]> {
    this.initialize();

    const mode = getExecutionMode();
    const candidates: Array<{ backend: InferenceBackend; health: HealthResult }> = [];

    // Check all backends in parallel
    const checks = this.backends.map(async (backend) => {
      if (!backend.canServe(model)) return null;
      // Execution mode filtering: local mode skips cloud backends entirely
      if (mode === "local" && backend.kind === "cloud") return null;
      if (!this.isCircuitClosed(backend.id)) return null;
      const health = await this.checkHealth(backend);
      if (!health.available) return null;
      return { backend, health };
    });

    const results = await Promise.all(checks);
    for (const r of results) {
      if (r) candidates.push(r);
    }

    // Sort by priority (lower first), with local backends preferred for local-prefix models
    candidates.sort((a, b) => a.backend.priority - b.backend.priority);

    return candidates.map((c) => c.backend);
  }

  /**
   * Resolve a single best backend for a model.
   * Returns null if no backend is available.
   */
  async resolveBestBackend(model: string): Promise<InferenceBackend | null> {
    const backends = await this.resolveBackends(model);
    return backends[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /**
   * Get a diagnostic snapshot of all backends and their health/circuit status.
   */
  async diagnostics(): Promise<Array<{
    id: string;
    label: string;
    kind: string;
    priority: number;
    available: boolean;
    circuitState: string;
    latencyMs?: number;
    models?: string[];
  }>> {
    this.initialize();

    const results = await Promise.all(
      this.backends.map(async (b) => {
        const health = await this.checkHealth(b);
        const circuit = this.getCircuit(b.id);
        return {
          id: b.id,
          label: b.label,
          kind: b.kind,
          priority: b.priority,
          available: health.available && this.isCircuitClosed(b.id),
          circuitState: circuit.state,
          latencyMs: health.latencyMs,
          models: health.models,
        };
      }),
    );

    return results;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/** Global backend registry singleton. */
let _registry: BackendRegistry | null = null;

/**
 * Get the global BackendRegistry singleton.
 * Lazily initializes on first call.
 */
export function getRegistry(): BackendRegistry {
  if (!_registry) {
    _registry = new BackendRegistry();
    _registry.initialize();
  }
  return _registry;
}

/**
 * Reset the registry (for testing).
 */
export function resetRegistry(): void {
  _registry = null;
}
