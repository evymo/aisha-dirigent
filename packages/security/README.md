# @aisha/security

> OWASP Top-10 hardening primitives shared across the AISHA Fastify + PostgREST stack.

Hardening building blocks that map 1:1 to the OWASP 2021 Top-10 categories
(A01–A10): structured logging, CORS, Helmet, rate limiting, JWT verification,
SSRF-safe outbound fetch, audit helpers, typed errors, and secret handling.
Used by every AISHA orchestrator service so security posture is uniform.

## Install

```sh
npm install @aisha/security
```

Published to the AISHA private registry (Verdaccio).

## Exports

| Subpath | OWASP focus |
|---|---|
| `@aisha/security/jwt` | A01/A07 — token verification |
| `@aisha/security/cors`, `/helmet`, `/rate-limit` | A05 — secure headers + limits |
| `@aisha/security/ssrf` | A10 — SSRF-safe fetch |
| `@aisha/security/audit`, `/logger` | A09 — logging + audit |
| `@aisha/security/secrets`, `/errors` | A02/A04 — secrets + safe errors |

## License

[Elastic License 2.0](../../LICENSE) — © Evymo s.r.o.

Part of the **AISHA platform**. Free to use, modify, and self-host (including
commercial use and client work); the single ELv2 restriction is that the
software may not be offered to third parties as a hosted or managed service.
See the [repository root](../../README.md) for the full licensing model.
