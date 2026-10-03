# scripts/lib/legacy/

> Knihovny, které byly aktivně integrované, ale aktuálně **nejsou používané**
> v hlavních deploy flow. Zachovány pro budoucí use, ale ne na hlavní cestě.

## metrics.mjs / metrics.sh — Prometheus textfile emitter

**Status**: legacy (od 2026-04-28)

**Důvod přesunu**: AISHA stack má specializovanou observability vrstvu:

| Vrstva | Nástroj | Pokrývá |
|---|---|---|
| Application errors | Sentry (`sentry.<internal-tld>`) | Exceptions, releases, user impact |
| Performance | Sentry Performance | p95 latency, transaction tracing |
| LLM operations | Langfuse | Token usage, cost, prompt latency |
| Custom events | ClickHouse | Generic event analytics |
| Container health | Coolify built-in | App status, deployment history |
| Logs | Dozzle + structured stdout | Manual debug |

Standalone Prometheus by duplikoval to, co už máme jinde, bez integration s
naší decision-making vrstvou (n8n + Sentry).

**Re-aktivace** (pokud někdy přibude potřeba CI artifact metrics, např. pro
build time analýzu mimo Coolify):

1. Move zpět: `mv scripts/lib/legacy/metrics.{mjs,sh} scripts/lib/`
2. Odkomentuj v [scripts/aisha-redeploy.mjs](../../../scripts/aisha-redeploy.mjs):
   ```js
   import { metrics } from "./lib/metrics.mjs";
   ```
3. Odkomentuj 8 řádků metric calls v summary blocku (viz git history před
   `2026-04-28`)
4. Re-add gate test reference v [src/tests/gates/lib-metrics.gate.test.ts](../../../src/tests/gates/lib-metrics.gate.test.ts)

Lib API zůstává stable — pretty/JSON dual mode, phase wrapper, label escape.
Pokud by se měnilo, gate testy v `lib-metrics.gate.test.ts` to chytnou.
