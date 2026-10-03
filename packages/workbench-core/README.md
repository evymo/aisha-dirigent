# @aisha/workbench-core

> Shared types, interfaces, and platform-agnostic adapters for AISHA Workbench and extensions.

The dependency-free contract layer for AISHA Workbench and its extensions: auth
state/credential types, the `IAuthAdapter` and `ITokenStorage` interfaces, and
platform-agnostic adapters so the same core runs across VS Code, web, and CLI
hosts.

## Install

```sh
npm install @aisha/workbench-core
```

Published to the AISHA private registry (Verdaccio).

## Exports

Single entry (`@aisha/workbench-core`) exporting `AuthState` / `AuthCredentials`
types and the `IAuthAdapter` / `ITokenStorage` interfaces.

## License

[Elastic License 2.0](../../LICENSE) — © Evymo s.r.o.

Part of the **AISHA platform**. Free to use, modify, and self-host (including
commercial use and client work); the single ELv2 restriction is that the
software may not be offered to third parties as a hosted or managed service.
See the [repository root](../../README.md) for the full licensing model.
