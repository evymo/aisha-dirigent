/**
 * OpenTelemetry SDK bootstrap for AISHA orchestrator services.
 *
 * Single-call API: `bootstrapOtel({ serviceName })` at the TOP of each
 * service's entrypoint (`services/<svc>/src/server.ts`), BEFORE any other
 * import that performs network I/O. The auto-instrumentations attach to
 * `http`, `fetch`, `pg`, `redis`, `ioredis`, and several other modules.
 *
 * Exporter: **Langfuse OTLP HTTP** (per Phase 12 plan §-1.12 R1 — Tempo
 * eliminated as redundant; Langfuse v2+ accepts general OpenTelemetry
 * traces and assigns LLM-rich UI to spans tagged with `gen_ai.*`).
 *
 * Why this lives in a workspace package (not duplicated per service):
 *   - Single source of truth for SDK version + exporter URL contract
 *   - Easy to swap exporters (Tempo, Honeycomb, Jaeger) in one place
 *   - Gate test (`wp-0-1-otel-bootstrap.gate.test.ts`) enforces every
 *     service entrypoint calls `bootstrapOtel` exactly once.
 *
 * Env contract (read by `readOtelConfig` below):
 *   OTEL_EXPORTER_OTLP_ENDPOINT    — Langfuse OTLP traces URL.
 *                                     Default: http://langfuse-server:3000/api/public/otel/v1/traces
 *   OTEL_SERVICE_NAME              — overrides constructor arg if set
 *   OTEL_SERVICE_VERSION           — defaults to `dev`
 *   OTEL_PROPAGATORS               — default `tracecontext,baggage`
 *   OTEL_SDK_DISABLED              — `true` short-circuits init (rollback)
 *   LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY — Basic auth for Langfuse OTLP
 *
 * Rollback: set `OTEL_SDK_DISABLED=true` in service env (Coolify UI) and
 * restart the container; SDK no-ops at startup, no other code touched.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { z } from 'zod';

const ConfigSchema = z.object({
  serviceName: z.string().min(1),
  serviceVersion: z.string().default('dev'),
  exporterUrl: z.string().url(),
  langfusePublicKey: z.string().optional(),
  langfuseSecretKey: z.string().optional(),
  disabled: z.boolean().default(false),
});

export type OtelConfig = z.infer<typeof ConfigSchema>;

export interface BootstrapOtelArgs {
  /** Required: short kebab-case service identifier (e.g. `svc-ai-chat`). */
  serviceName: string;
  /** Optional override of service version (otherwise from env or `dev`). */
  serviceVersion?: string;
}

export interface BootstrapOtelResult {
  sdk: NodeSDK | null;
  config: OtelConfig;
  disabled: boolean;
}

/**
 * Read OTel configuration from process.env. Returns a parsed config; throws
 * Zod error if exporter URL is malformed (caller should treat as fatal —
 * misconfigured observability silently masks production issues).
 */
export function readOtelConfig(args: BootstrapOtelArgs): OtelConfig {
  const raw = {
    serviceName: process.env.OTEL_SERVICE_NAME ?? args.serviceName,
    serviceVersion:
      process.env.OTEL_SERVICE_VERSION ?? args.serviceVersion,
    exporterUrl:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      'http://langfuse-server:3000/api/public/otel/v1/traces',
    langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY,
    langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY,
    disabled: process.env.OTEL_SDK_DISABLED === 'true',
  };
  // Strip undefined so Zod defaults apply
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined),
  );
  return ConfigSchema.parse(cleaned);
}

/**
 * Build OTLP exporter headers. When both Langfuse keys are set, includes
 * Basic auth required by Langfuse OTLP endpoint. Otherwise empty (useful
 * for local dev against unauthenticated collectors / Jaeger).
 */
export function buildExporterHeaders(
  config: Pick<OtelConfig, 'langfusePublicKey' | 'langfuseSecretKey'>,
): Record<string, string> {
  if (!config.langfusePublicKey || !config.langfuseSecretKey) {
    return {};
  }
  const token = Buffer.from(
    `${config.langfusePublicKey}:${config.langfuseSecretKey}`,
  ).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/**
 * Bootstrap OpenTelemetry SDK. Idempotent within a single process (NodeSDK
 * tracks its own state). Returns the started SDK so callers can `await
 * sdk.shutdown()` on SIGTERM if desired.
 *
 * Calling pattern (entrypoint of every service):
 *   ```ts
 *   import { bootstrapOtel } from '@aisha/observability/otel';
 *   const otel = bootstrapOtel({ serviceName: 'svc-ai-chat' });
 *   // ... rest of imports + Fastify setup
 *   ```
 *
 * When `OTEL_SDK_DISABLED=true`, returns `{ sdk: null, disabled: true }`
 * and emits NO spans. Acts as the rollback path per Phase 12 WP 0.1.
 */
export function bootstrapOtel(args: BootstrapOtelArgs): BootstrapOtelResult {
  const config = readOtelConfig(args);

  if (config.disabled) {
    return { sdk: null, config, disabled: true };
  }

  const traceExporter = new OTLPTraceExporter({
    url: config.exporterUrl,
    headers: buildExporterHeaders(config),
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
    }),
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // `fs` produces enormous span volume in production — disable.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // `net`/`dns` are low-value and noisy alongside `http`.
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown on SIGTERM (Coolify deploy hook). Awaited by the
  // process exit so spans flush before container restart.
  const shutdown = (): void => {
    sdk
      .shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return { sdk, config, disabled: false };
}
