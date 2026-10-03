# AISHA Dirigent — Containerized E2E Suite

> Verifies the local supervisor surface across **VS Code** (via `code-server`)
> and **Claude Code CLI**. Cursor + Zed coverage is generator-test-only — see
> [§ 4 Scope decision](#4-scope-decision-cursor--zed) for why.

---

## 1. What this suite proves

The supervisor pipeline (per
[docs/architecture/dirigent-overlay-pipeline.md](../../docs/architecture/dirigent-overlay-pipeline.md))
has three runtime moments that the rest of the test pyramid can't catch:

| # | Behavior | Covered by container e2e |
|---|---|---|
| 1 | VS Code extension **notifies** developer on platform-rule violation as they type | `playwright/specs/extension-notification.spec.ts` |
| 2 | VS Code extension **relays a backend-pushed advisory** to the chat panel when the backend escalates | `playwright/specs/extension-relay-escalation.spec.ts` |
| 3 | VS Code extension **respects 45 s cooldown** per rule (one toast per rule per cooldown window) | `playwright/specs/extension-cooldown.spec.ts` |
| 4 | Claude Code CLI **fires PreToolUse hook** on Edit/Write of a file containing a violation, prints advisory on stderr, exits 0 | `cli/claude-hook-fires.spec.mjs` |
| 5 | Claude Code CLI **injects backend `additionalContext`** into a SessionStart event when relay hook is present and `AISHA_MCP_TOKEN` is set | `cli/claude-relay-injects.spec.mjs` |

Together these prove the user's invariant: *"the agent locally must notify
and forward backend escalation messages — and we need this covered by
repeatable tests."*

## 2. Architecture

```
┌──────────────────────┐   ┌────────────────────────────────┐
│   mock-backend       │   │   workspace-fixture (mounted)  │
│   (fastify, :3030)   │   │   /workspace                   │
│                      │   │     src/violation.ts (regex hit)│
│   /dirigent/dispatch │   │     .claude/{hooks,settings,...}│
│   /rpc/mcp_get_...   │   │   (the same overlay the         │
│   /rpc/dirigent_drain│   │    generator emits)             │
└──────────┬───────────┘   └────────────────────────────────┘
           │ HTTP fixtures (controllable per spec)
           │
   ┌───────┴───────────────────────────────┐
   │                                       │
┌──▼────────────────────┐    ┌─────────────▼───────────────┐
│  code-server :8443    │    │  claude-cli (long-running)  │
│  (browser-based       │    │  shell w/ node-pty harness  │
│   VS Code)            │    │                             │
│                       │    │  reads .claude/* from mount │
│  + aisha-dirigent     │    │  hooks fire on simulated    │
│    extension VSIX     │    │    PreToolUse events        │
│                       │    │                             │
│  Playwright drives    │    │  Node spec asserts stderr   │
│   DOM via Chromium    │    │   + additionalContext       │
└───────────────────────┘    └─────────────────────────────┘
```

**Why mock backend (vs. hitting real api.aisha.guru)**: e2e in CI must be
deterministic. Real production state changes outside this repo's release
cycle (n8n WFs can be deactivated, RPCs can return new shapes, LLM advisory
is non-deterministic). Mock backend pins the stimulus-response loop.

The mock backend's response shapes are **derived from the same TypeScript
contracts** the real backend uses (see `mock-backend/fixtures/*.ts` imports
from `services/svc-ai-chat/src/routes/dirigent-supervisor.ts`).

## 3. Running

### Locally (no Docker)

```bash
cd tests/e2e-dirigent
npm install       # one-time: installs @playwright/test, fastify, node-pty
npm run start:mock-backend   # in one terminal
npm run test:vscode          # in another (uses local code-server)
npm run test:cli             # uses locally-installed claude-cli
```

### Fully containerized (CI parity)

```bash
cd tests/e2e-dirigent
docker compose up -d --build  # ~2 min first time, ~10s cached
npm run test                  # runs both VS Code + CLI specs
docker compose down
```

### CI (Forgejo Actions — pure-Node tier only)

`.forgejo/workflows/e2e-dirigent.yml` runs a **pure-Node subset** of this
suite — boots the mock backend in-process (no Docker), runs the CLI
hook + relay specs against it. Target wall time: < 5 min.

**Why CI doesn't run the full Docker stack:** the only Forgejo runner
currently registered on `repo.id3a.cz` (`aisha-runner`, labels:
`ubuntu-latest, ubuntu-22.04, self-hosted`) does not have DinD enabled.
Until a docker-capable runner is added, the VS Code Playwright tier is
**local-dev verification only** — contributors run
`npm run test:e2e:dirigent` from their workstation before merging
supervisor-affecting changes.

| Tier | Runs in CI | Runs locally | Coverage |
|---|---|---|---|
| Mock backend boot + smoke | ✅ | ✅ | 5 default bindings serve correctly |
| CLI hook specs (7 advise scripts + cooldown) | ✅ | ✅ | bash + python3, no Docker |
| CLI relay specs (5 fail-open + dispatch tests) | ✅ | ✅ | Node 18+ fetch, no Docker |
| Playwright VS Code specs (9 tests) | ❌ | ✅ | Requires docker compose + code-server |
| Drift gates (workspace-fixture sync) | ✅ via `test:gates` | ✅ | vitest, no Docker |

Same behaviors verified at unit level when CI can't run the full stack:
- `extensions/aisha-dirigent/__tests__/rules-engine.test.ts` (21 tests on cache + matcher)
- `src/tests/gates/claude-overlay-{drift,runtime,fixture-drift}.gate.test.ts`

## 4. Scope decision: Cursor + Zed

**Out of scope for runtime e2e. Generator-test coverage is the contract.**

| IDE | Why not container-runtime testable | Where it IS tested |
|---|---|---|
| Cursor | Closed-source Electron fork. No headless / `code-server`-equivalent build. xvfb+VNC tests on the Linux Electron binary are brittle and rebuild every Cursor release. | `scripts/ide-adapters/adapter-cursorrules.mjs` byte-output test in `src/tests/gates/` + drift gate ensures `.cursorrules` matches SoT |
| Zed | Native Rust GUI, no headless mode, no scripting bridge. | `scripts/ide-adapters/adapter-zedrules.mjs` byte-output test + drift gate |
| Windsurf | Closed-source Electron, same constraints as Cursor. | `adapter-windsurfrules.mjs` byte-output test |
| Codex | CLI tool but proprietary, not Anthropic-shipped. Hooks contract still emerging. | `adapter-codex-skill.mjs` byte-output test |

The supervision **contract** for Cursor/Zed/Windsurf is text rules injected
into the LLM's chat context — there is no hook execution to assert on.
Asserting "the LLM followed the rule" would require running an LLM under
test, which is non-deterministic. The deterministic contract is "the rule
text is byte-identical to SoT after generation", which the existing drift
gates already cover.

## 5. Layout

```
tests/e2e-dirigent/
├── README.md                           ← this file
├── package.json                        ← test runner deps
├── docker-compose.yml                  ← orchestrates 3 containers
├── playwright.config.ts                ← targets http://code-server:8443
├── mock-backend/
│   ├── server.ts                       ← fastify with controllable fixtures
│   ├── fixtures/
│   │   ├── bindings.ts                 ← canned mcp_get_claude_hook_bindings
│   │   ├── dispatch.ts                 ← canned /dirigent/dispatch responses
│   │   └── nudges.ts                   ← canned dirigent_drain_nudges queue
│   └── package.json
├── workspace-fixture/                  ← realistic dev workspace mounted into both IDEs
│   ├── src/
│   │   └── violation.ts                ← intentional rule violations
│   └── .claude/                        ← copied verbatim from repo .claude/
├── docker/
│   ├── Dockerfile.code-server          ← ubuntu + node + code-server + VSIX
│   ├── Dockerfile.claude-cli           ← ubuntu + node + @anthropic-ai/claude-code
│   └── Dockerfile.mock-backend         ← node:20-alpine + fastify
├── playwright/
│   ├── fixtures/
│   │   └── code-server.ts              ← waits for /healthz, returns Page handle
│   └── specs/
│       ├── extension-notification.spec.ts
│       ├── extension-relay-escalation.spec.ts
│       └── extension-cooldown.spec.ts
└── cli/
    ├── harness.mjs                     ← node-pty wrapper that spawns claude-cli
    ├── claude-hook-fires.spec.mjs
    └── claude-relay-injects.spec.mjs
```

## 6. Adding a new spec

1. Pick the surface: VS Code (Playwright) or Claude CLI (node-pty).
2. Add a new fixture to `mock-backend/fixtures/` if you need a new backend
   response shape. Re-export from `mock-backend/server.ts`.
3. Write the spec — use existing ones as templates.
4. Run locally: `npm run test:vscode -- --grep "your test name"`.
5. Commit. CI runs full suite on every push.

## 7. Maintaining the workspace fixture

`workspace-fixture/.claude/` is **a snapshot** of the repo's `.claude/`
overlay at test time. When the overlay regenerates (new rule added), copy
the relevant files in:

```bash
cp -r ../../.claude/hooks tests/e2e-dirigent/workspace-fixture/.claude/
cp -r ../../.claude/agents tests/e2e-dirigent/workspace-fixture/.claude/
cp -r ../../.claude/skills tests/e2e-dirigent/workspace-fixture/.claude/
cp -r ../../.claude/commands tests/e2e-dirigent/workspace-fixture/.claude/
cp ../../.claude/statusline.sh tests/e2e-dirigent/workspace-fixture/.claude/
cp ../../.claude/settings.json tests/e2e-dirigent/workspace-fixture/.claude/
```

A `claude-overlay-fixture-drift.gate` test (in `src/tests/gates/`) enforces
the snapshot stays in sync — see [`8. Drift protection`](#8-drift-protection).

## 8. Drift protection

Three gates already enforce SoT integrity:

| Gate | What it catches |
|---|---|
| `claude-overlay-drift.gate.test.ts` | `.claude/*` differs from generator output |
| `claude-overlay-runtime.gate.test.ts` | hook script doesn't fire on its positive sample |
| `claude-overlay-fixture-drift.gate.test.ts` *(new with this suite)* | `tests/e2e-dirigent/workspace-fixture/.claude/` differs from repo `.claude/` |

The third gate is what makes the e2e suite trustworthy over time — without
it the snapshot would silently drift and we'd be testing yesterday's
overlay.
