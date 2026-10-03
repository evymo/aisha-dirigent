# AISHA ZEDBENCH and Zed Dirigent Integration

## Product statement

AISHA Dirigent for Zed is the first delivery step toward **AISHA ZEDBENCH**: a Zed-based AISHA Workbench that keeps the speed and Agent Panel/MCP strengths of stock Zed while reusing the existing AISHA Dirigent contracts for setup, story context, rules, health, profile switching, quality gates, model routing, and workflow orchestration.

The Zed integration is not an MCP config helper. It is an IDE orchestration surface that should converge with the VS Code Dirigent extension through shared contracts and generated instruction artifacts.

## Delivery stages

| Stage | Purpose |
|---|---|
| Stock Zed extension | Installable Zed extension that registers the AISHA MCP context server and uses `.rules` as the native Agent Panel instruction layer. |
| AISHA MCP bridge / sidecar | Local stdio MCP process that resolves profiles, reads workspace context, forwards tool calls to AISHA Runtime/MCP, and stays DB-blind. |
| AISHA ZEDBENCH distribution | Future AISHA-branded Zed-based workbench with bundled extension, defaults, onboarding, rules, profile setup, and AISHA-first workflow conventions. |

## Architecture

| Layer | Responsibility |
|---|---|
| Zed extension | Registers the AISHA context server, exposes setup/repair/open actions where Zed APIs allow, starts the sidecar, and reads project/user settings. |
| MCP bridge / sidecar | Runs as Zed stdio MCP server, forwards tools/prompts, reads workspace/git/story/session files, builds Dirigent Brief payloads, and performs health checks. |
| AISHA Dirigent Runtime API | Owns auth, profiles, story context, workflow routing, health, model routing, bootstrap, and rules payload generation. |
| AISHA MCP server | Provides canonical tools such as `suggest_next_step`, `assess_quality`, `evaluate_tests`, `check_pr_compliance`, `estimate_effort`, `get_story_context`, `search_knowledge`, and `route_task`. |
| Web cockpit / Appsmith | Remains the durable governance and operations control plane for approvals, dashboards, audit, model policy, workflows, and incidents. |

## Zed-native `.rules`

Zed loads `.rules` before compatibility files such as `.cursorrules`, `.windsurfrules`, `AGENTS.md`, or `CLAUDE.md`. AISHA therefore generates `.rules` through the `zedrules` adapter.

The `.rules` file is a baseline prompt layer, not a replacement for MCP. It tells the Zed Agent Panel to:

- treat AISHA Dirigent as the authority for story, flow, quality, compliance, routing, and high-risk decisions;
- prefer AISHA MCP tools for project-level decisions;
- avoid irreversible actions without Dirigent approval;
- keep Zed-facing workflows on AISHA Runtime/API vocabulary instead of database or Supabase internals.

Generate it with:

```bash
npm run gen:ide -- --format=zedrules
```

If an offline payload exists:

```bash
npm run gen:ide:offline -- --format=zedrules
```

## Clean Zed configuration vocabulary

Zed and ZEDBENCH UX must use AISHA Runtime names:

| Key | Meaning |
|---|---|
| `aisha.apiBaseUrl` | AISHA Gateway / Runtime API base URL. |
| `aisha.mcpUrl` | AISHA MCP endpoint. |
| `aisha.clientToken` | IDE/client token stored locally, never in tracked files. |
| `aisha.activeProfile` | `local`, `cloud`, `staging`, or `custom`. |
| `aisha.storyId` | Active story context. |
| `aisha.guidanceProfile` | `beginner`, `intermediate`, `advanced`, or `expert`. |
| `aisha.routingMode` | `local`, `hybrid`, or `cloud`. |
| `aisha.sidecar.enabled` | Whether the MCP bridge/watcher is enabled. |
| `aisha.rules.autoSync` | Whether `.rules` should be regenerated when story/rules change. |

Avoid user-facing `supabaseUrl`, `anonKey`, Postgres, table, or service-role terminology in Zed. The bridge may translate to legacy fields internally only when calling existing backend compatibility endpoints.

## Profile and file contracts

| File | Tracking | Purpose |
|---|---|---|
| `.aisha/dirigent.json` | tracked, non-secret | Project defaults and non-secret profile metadata. |
| `.aisha/dirigent.local.json` | local only | Per-user profile, local endpoints, tokens, and preferences. |
| `.aisha/story.json` | shared context | Active story ID used by editors, CLI, and sidecar. |
| `.aisha/session.json` | local/session | Current IDE session and orchestration state. |
| `.rules` | generated | Zed Agent Panel baseline instructions. |

## MCP bridge requirements

The sidecar should:

- implement stdio MCP `initialize`, `tools/list`, `tools/call`, and later `prompts/list` / `prompts/get`;
- forward canonical AISHA tools to the configured AISHA MCP endpoint;
- expose local helper tools for setup/connect, health/repair, profile switching, story, routing, dashboard links, Dirigent Brief queue, and rules sync;
- resolve config from environment, `.aisha/dirigent.local.json`, `.aisha/dirigent.json`, extension settings, and launch arguments;
- inspect workspace metadata, git branch/status/diff, and selected context where available;
- never use service-role keys, direct Postgres, table schemas, or privileged database access.

## Command and Agent Panel parity

Desired Zed command/action entrypoints:

| Command | Purpose |
|---|---|
| `AISHA: Connect` | First setup of backend profile, token, MCP server, and active story. |
| `AISHA: Switch Backend` | Switch `local`, `cloud`, `staging`, or `custom` profile. |
| `AISHA: Install MCP Server` | Register or show settings for the AISHA MCP context server. |
| `AISHA: Repair MCP Server` | Validate profile, sidecar, MCP, auth, story, and `.rules`. |
| `AISHA: Set Active Story` | Select and persist story context. |
| `AISHA: Clear Session` | Clear local session state. |
| `AISHA: Sync Rules` | Regenerate `.rules`. |
| `AISHA: Health Check` | Check Runtime API, MCP, auth, story, sidecar, profile, and rules. |
| `AISHA: Open Dashboard` | Open or print the cockpit/Appsmith/story dashboard URL. |

Desired Agent Panel slash-equivalent intents:

| Intent | MCP mapping |
|---|---|
| `/aisha-next` | `suggest_next_step` |
| `/aisha-quality` | `assess_quality` |
| `/aisha-test` | `evaluate_tests` |
| `/aisha-compliance` | `check_pr_compliance` |
| `/aisha-estimate` | `moderate_flow` + `estimate_effort` |
| `/aisha-story` | `get_story_context` |
| `/aisha-route` | `route_task` |
| `/aisha-dirigent` | high-level orchestration through `moderate_flow` and Runtime workflow routing. |

If Zed does not expose first-class custom slash commands, these should be implemented as MCP prompts/tools plus `.rules` guidance.

## Implemented local MCP helper tools

| Tool | Flow covered |
|---|---|
| `aisha_connect` | `AISHA: Connect` / onboarding / profile setup. |
| `aisha_set_profile` | backend switching. |
| `aisha_set_story` | active story selection. |
| `aisha_sync_rules` | `.rules` sync. |
| `aisha_repair_mcp` | MCP/config/rules repair. |
| `aisha_set_routing_mode` | local/hybrid/cloud routing mode. |
| `aisha_start_watcher` / `aisha_stop_watcher` | lightweight sidecar watcher lifecycle. |
| `aisha_queue_dirigent_brief` | pending Dirigent Brief queue. |
| `aisha_model_routing_status` | model routing visibility. |
| `aisha_open_dashboard` | cockpit/story/health deep links. |

These are implemented as MCP tools because Zed command/slash registration APIs may not cover full VS Code Chat Participant parity. Native Zed commands can later delegate to the same bridge tools.

## Shared core extraction

`packages/dirigent-core` now contains the first editor-neutral contracts used by the Zed bridge:

- workspace root detection;
- `.aisha` path contracts;
- story read/write;
- profile resolution;
- config redaction;
- local config mutation.

VS Code Dirigent should migrate to this package incrementally so Zed, VS Code, and ZEDBENCH maintain profile/story/session logic once.

## Boundary with AISHA Workbench and cockpit

Zed/ZEDBENCH is the developer-edge workbench: editing, story context, rules, Agent Panel orchestration, local signals, and health/repair.

The web cockpit and Appsmith dashboards remain the governance/control plane: users, stories, approvals, audit, model policy, workflow operations, deploy/rollback, observability, and incident dashboards.

Zed should deep-link to cockpit surfaces rather than reimplementing durable governance UI inside the editor.
