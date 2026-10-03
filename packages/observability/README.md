# @aisha/observability

> OpenTelemetry bootstrap + Prometheus metrics — one instrumentation surface for AISHA services.

A single instrumentation entry point for AISHA orchestrator services:
OpenTelemetry SDK bootstrap (auto-instrumentations, OTLP trace exporter routed
to Langfuse) plus a Prometheus metrics adapter via `prom-client`. Import once;
traces and metrics are wired consistently across every service.

## Install

```sh
npm install @aisha/observability
```

Published to the AISHA private registry (Verdaccio).

## Exports

| Subpath | What |
|---|---|
| `@aisha/observability` | Top-level barrel |
| `@aisha/observability/otel` | OTel SDK bootstrap (OTLP → Langfuse) |
| `@aisha/observability/metrics` | Prometheus (`prom-client`) adapter |

## License

[Elastic License 2.0](../../LICENSE) — © Evymo s.r.o.

Part of the **AISHA platform**. Free to use, modify, and self-host (including
commercial use and client work); the single ELv2 restriction is that the
software may not be offered to third parties as a hosted or managed service.
See the [repository root](../../README.md) for the full licensing model.
