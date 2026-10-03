# @aisha/cache-redis

> Shared Redis client for AISHA services — DB-index isolation, env AUTH, named primitives.

Wraps `ioredis` with database-index isolation, AUTH from the environment, and
named primitives for caching, JWT revocation, and realtime state. Reuses the
shared `aisha-shared-redis` instance so every service points at one Redis with
clean logical separation.

## Install

```sh
npm install @aisha/cache-redis
```

Published to the AISHA private registry (Verdaccio).

## Exports

| Subpath | What |
|---|---|
| `@aisha/cache-redis` | Top-level barrel |
| `@aisha/cache-redis/client` | DB-index-isolated ioredis client factory |
| `@aisha/cache-redis/revocation` | JWT revocation list primitives |

## License

[Elastic License 2.0](../../LICENSE) — © Evymo s.r.o.

Part of the **AISHA platform**. Free to use, modify, and self-host (including
commercial use and client work); the single ELv2 restriction is that the
software may not be offered to third parties as a hosted or managed service.
See the [repository root](../../README.md) for the full licensing model.
