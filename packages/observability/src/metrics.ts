/**
 * Prometheus metrics adapter — `/metrics` endpoint + default Node.js
 * process metrics. Used by Phase 12 WP 0.4 (service `/metrics` exporter
 * wiring) so each service exposes `/metrics` for scraping by the
 * Prometheus instance deployed in WP 0.2 (Loki + Prom + Grafana stack).
 *
 * Auth: `/metrics` is internal-only — bound on the same Fastify instance
 * but should be reachable ONLY from `backend-net` per WP 3.4 segmentation
 * (Prometheus scraper is on that net). Public exposure leaks operational
 * topology + Postgres query patterns.
 */
import type { FastifyInstance } from 'fastify';
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

export interface MetricsPluginOptions {
  /** Service name → prepended as label to default metrics. */
  serviceName: string;
  /** Path to expose the registry — default `/metrics`. */
  path?: string;
  /** Disable everything when `false` — useful in tests. */
  enabled?: boolean;
}

/**
 * Per-service custom counters/histograms wired by AISHA conventions:
 *   - aisha_rpc_calls_total{rpc, status} — counter of every RPC call
 *   - aisha_llm_calls_total{provider, model, status} — counter of LLM
 *     completions (incremented by `llmAdapter.ts` in WP 0.3)
 *   - aisha_rpc_duration_ms{rpc} — histogram of PostgREST RPC duration
 *   - aisha_request_duration_ms{route, status} — histogram of HTTP
 *     request duration (wraps Fastify onResponse hook)
 */
export interface AishaMetrics {
  registry: Registry;
  rpcCalls: Counter<'rpc' | 'status'>;
  llmCalls: Counter<'provider' | 'model' | 'status'>;
  rpcDuration: Histogram<'rpc'>;
  requestDuration: Histogram<'route' | 'status'>;
}

const PERCENTILE_BUCKETS_MS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000,
];

/** Build a per-service AishaMetrics registry. Each service calls once. */
export function createAishaMetrics(serviceName: string): AishaMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });

  // Default Node.js process metrics: heap, GC, event loop lag, etc.
  collectDefaultMetrics({ register: registry });

  const rpcCalls = new Counter({
    name: 'aisha_rpc_calls_total',
    help: 'Total PostgREST RPC calls per function and status (ok|error).',
    labelNames: ['rpc', 'status'],
    registers: [registry],
  });

  const llmCalls = new Counter({
    name: 'aisha_llm_calls_total',
    help: 'Total LLM API calls per provider, model, and status.',
    labelNames: ['provider', 'model', 'status'],
    registers: [registry],
  });

  const rpcDuration = new Histogram({
    name: 'aisha_rpc_duration_ms',
    help: 'PostgREST RPC duration in milliseconds.',
    labelNames: ['rpc'],
    buckets: PERCENTILE_BUCKETS_MS,
    registers: [registry],
  });

  const requestDuration = new Histogram({
    name: 'aisha_request_duration_ms',
    help: 'HTTP request duration in milliseconds.',
    labelNames: ['route', 'status'],
    buckets: PERCENTILE_BUCKETS_MS,
    registers: [registry],
  });

  return { registry, rpcCalls, llmCalls, rpcDuration, requestDuration };
}

/**
 * Mount `/metrics` route + onResponse hook for request_duration_ms on a
 * Fastify instance. Idempotent — re-registering the same route throws,
 * so callers must call once at startup (typically right after
 * `applySecurity`).
 *
 * NOTE: route is NOT rate-limited (Prometheus scrapes every 15-30s).
 * Authentication: relies on network segmentation (per WP 3.4) — not
 * exposed via gateway to public. If gateway proxies `/metrics` upstream
 * by mistake, the value leak is operational (cardinality, query names)
 * but not credentials — verified by gate test.
 */
export async function registerMetricsPlugin(
  app: FastifyInstance,
  options: MetricsPluginOptions,
): Promise<AishaMetrics> {
  const { serviceName, path = '/metrics', enabled = true } = options;

  const metrics = createAishaMetrics(serviceName);

  if (!enabled) {
    return metrics;
  }

  app.get(path, async (_req, reply) => {
    reply.header('Content-Type', metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  });

  // Request duration onResponse hook — uses Fastify's `request.routeOptions.url`
  // (the route template, not the resolved path with params) to keep label
  // cardinality bounded.
  app.addHook('onResponse', async (req, reply) => {
    const route =
      req.routeOptions?.url ?? req.url.split('?')[0] ?? 'unknown';
    const status = String(reply.statusCode);
    metrics.requestDuration.observe(
      { route, status },
      reply.elapsedTime ?? 0,
    );
  });

  return metrics;
}
