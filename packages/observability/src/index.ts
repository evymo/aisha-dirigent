/**
 * @aisha/observability — unified observability primitives.
 *
 * - `otel.ts` → OpenTelemetry SDK bootstrap (traces to Langfuse OTLP)
 * - `metrics.ts` → Prometheus `/metrics` adapter + AISHA standard counters
 *
 * Usage in every service's `src/server.ts`:
 *   ```ts
 *   import { bootstrapOtel } from '@aisha/observability/otel';
 *   import { registerMetricsPlugin } from '@aisha/observability/metrics';
 *
 *   // MUST be first import call with side effects — auto-instrumentations
 *   // patch HTTP/fetch/pg/redis at module-load time.
 *   bootstrapOtel({ serviceName: 'svc-ai-chat' });
 *
 *   // ... rest of Fastify setup
 *   await registerMetricsPlugin(app, { serviceName: 'svc-ai-chat' });
 *   ```
 *
 * Rollback: `OTEL_SDK_DISABLED=true` env (per-service in Coolify) → SDK
 * no-ops at startup, all other code unchanged.
 */

export * from './otel.js';
export * from './metrics.js';
