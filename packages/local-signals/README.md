# @aisha/local-signals

> Versioned local-signal envelope + terminal-output classification for the Dirigent overlay.

Zod-schema'd primitives for local developer-machine signals consumed by the
AISHA Dirigent supervision overlay: a versioned signal `envelope` (severity,
diagnostics, ranges) and a terminal-output `terminalParsing` classifier that
maps shell command output to watched command types. Pure, Zod-validated, no
side effects.

## Install

```sh
npm install @aisha/local-signals
```

Published to the AISHA private registry (Verdaccio).

## Exports

Single entry (`@aisha/local-signals`) re-exporting `envelope` (signal schemas)
and `terminalParsing` (command classification).

## License

[Elastic License 2.0](../../LICENSE) — © Evymo s.r.o.

Part of the **AISHA platform**. Free to use, modify, and self-host (including
commercial use and client work); the single ELv2 restriction is that the
software may not be offered to third parties as a hosted or managed service.
See the [repository root](../../README.md) for the full licensing model.
