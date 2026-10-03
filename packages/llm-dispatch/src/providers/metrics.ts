/**
 * Metrics bridge — OPTIONAL, no-op-by-default access to the AISHA Prometheus
 * counters defined in `@aisha/observability`.
 *
 * WHY a bridge instead of `import { ... } from '@aisha/observability'`:
 *   - `@aisha/llm-dispatch` is imported by frontend bundles and one-off scripts
 *     that must NOT pull in `prom-client` / the OpenTelemetry SDK. A hard
 *     dependency on `@aisha/observability` would break those non-server
 *     consumers (and bloat their bundles).
 *   - So we read the process-global metrics handle a service publishes at
 *     startup and fall back to a no-op when it is absent. Zero import, zero dep.
 *
 * A service wires the real registry once at boot:
 *   ```ts
 *   import { createAishaMetrics } from '@aisha/observability/metrics';
 *   import { setAishaMetrics } from '@aisha/llm-dispatch';
 *   setAishaMetrics(createAishaMetrics('svc-ai-chat'));
 *   ```
 * Until then (frontend / scripts / tests) every `.inc()` / `.observe()` is a
 * no-op — the counters simply stay unpublished.
 *
 * INVARIANTS:
 *   - Bounded label cardinality: only `provider` (fixed backend id), `model`
 *     (resolved model id from the backend registry — NOT free-form user input)
 *     and `status` ('ok' | 'error') are ever used as labels.
 *   - No-op when metrics are not registered.
 *
 * @module
 */

/** Structural subset of a prom-client Counter — avoids importing prom-client. */
export interface MetricCounterLike {
  inc(labels?: Record<string, string | number>, value?: number): void;
}

/** Structural subset of a prom-client Histogram. */
export interface MetricHistogramLike {
  observe(labels: Record<string, string | number>, value: number): void;
}

/** The subset of `AishaMetrics` (from @aisha/observability) this package emits. */
export interface AishaMetricsHandle {
  llmCalls: MetricCounterLike;
  rpcCalls?: MetricCounterLike;
  rpcDuration?: MetricHistogramLike;
  requestDuration?: MetricHistogramLike;
}

const NOOP_COUNTER: MetricCounterLike = { inc() {} };

const NOOP_METRICS: AishaMetricsHandle = {
  llmCalls: NOOP_COUNTER,
};

/** Process-global slot key — shared, string-keyed to avoid a symbol import. */
const GLOBAL_KEY = "__aishaMetrics__";

type GlobalWithMetrics = typeof globalThis & {
  [GLOBAL_KEY]?: AishaMetricsHandle;
};

/**
 * Publish the process-global metrics handle. A server calls this once at
 * startup with the result of `createAishaMetrics(serviceName)`; frontend and
 * script consumers never call it, so the no-op fallback stays in effect.
 */
export function setAishaMetrics(metrics: AishaMetricsHandle): void {
  (globalThis as GlobalWithMetrics)[GLOBAL_KEY] = metrics;
}

/**
 * Read the process-global metrics handle, or a no-op stand-in when no service
 * has registered one. Never throws; safe to call from any environment.
 */
export function getAishaMetrics(): AishaMetricsHandle {
  const registered = (globalThis as GlobalWithMetrics)[GLOBAL_KEY];
  if (registered && typeof registered.llmCalls?.inc === "function") {
    return registered;
  }
  return NOOP_METRICS;
}

/**
 * Increment `aisha_llm_calls_total{provider,model,status}` for one provider
 * call. Bounded-cardinality: `model` is the resolved backend model id, not
 * arbitrary user input. No-op when no service registered a metrics handle.
 */
export function recordLlmCall(
  provider: string,
  model: string,
  status: "ok" | "error",
): void {
  getAishaMetrics().llmCalls.inc({ provider, model, status });
}
