# @aisha/audience-types

> Universal audience domain model — types, the IDataSource contract, tier derivation, scope rules.

The shared TypeScript domain layer for the AISHA audience capability:
zero-runtime-dependency types and pure functions used by `svc-source-broker`,
future broker services, and Appsmith bindings. A single source of truth for
member tiers, aggregation shapes, and the federated `IDataSource` contract.

## Install

```sh
npm install @aisha/audience-types
```

Published to the AISHA private registry (Verdaccio).

## Exports

| Subpath | What |
|---|---|
| `@aisha/audience-types` | Top-level barrel |
| `@aisha/audience-types/member-tier` | Tier derivation |
| `@aisha/audience-types/aggregation` | Aggregation shapes |
| `@aisha/audience-types/IDataSource` | Federated data-source contract |
| `@aisha/audience-types/entities` | Core entity types |

## License

[Elastic License 2.0](../../LICENSE) — © Evymo s.r.o.

Part of the **AISHA platform**. Free to use, modify, and self-host (including
commercial use and client work); the single ELv2 restriction is that the
software may not be offered to third parties as a hosted or managed service.
See the [repository root](../../README.md) for the full licensing model.
