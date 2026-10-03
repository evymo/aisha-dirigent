# @aisha/aitg

> OWASP AI Testing Guide (AITG) v1 primitives — verify every LLM call with one import.

Catalog metadata, Zod schemas, classifiers, the run emitter, and the
`withAitgGuard()` call-site middleware shared across the AISHA orchestrator
services, so any service touching an LLM call can self-verify against the OWASP
AI Testing Guide.

## Install

```sh
npm install @aisha/aitg
```

Published to the AISHA private registry (Verdaccio).

## Exports

| Subpath | What |
|---|---|
| `@aisha/aitg` | Top-level barrel |
| `@aisha/aitg/catalog` | AITG test catalog metadata |
| `@aisha/aitg/schemas` | Zod schemas for AITG runs/results |
| `@aisha/aitg/classifiers` | Result classifiers |
| `@aisha/aitg/runner` | Run emitter |
| `@aisha/aitg/guard` | `withAitgGuard()` call-site middleware |
| `@aisha/aitg/continuous`, `/automation` | Continuous + automated evaluation helpers |

```ts
import { withAitgGuard } from "@aisha/aitg/guard";
const result = await withAitgGuard(() => llm.complete(prompt), { /* ctx */ });
```

## License

[Elastic License 2.0](../../LICENSE) — © Evymo s.r.o.

Part of the **AISHA platform**. Free to use, modify, and self-host (including
commercial use and client work); the single ELv2 restriction is that the
software may not be offered to third parties as a hosted or managed service.
See the [repository root](../../README.md) for the full licensing model.
