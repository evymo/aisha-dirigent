# AISHA IDE Extension Contract

This contract defines the editor-neutral surface shared by AISHA IDE clients: VS Code Dirigent, stock Zed extension, future AISHA ZEDBENCH, CLI tools, and sidecars.

## Principles

1. Editors are clients of AISHA Runtime and MCP contracts, not owners of platform internals.
2. Editor UX must use AISHA Runtime vocabulary and avoid database/Supabase/Postgres terminology.
3. Local files carry workspace context; Runtime/MCP carries authoritative decisions.
4. Secrets stay in local user config or editor secret storage, never in tracked repository files.
5. High-risk or irreversible actions require AISHA Dirigent approval and the relevant cockpit approval path.

## Runtime configuration keys

| Key | Allowed values / shape | Notes |
|---|---|---|
| `apiBaseUrl` | URL | AISHA Gateway / Runtime API. |
| `mcpUrl` | URL | AISHA MCP endpoint. |
| `clientToken` | opaque token | Local secret. Do not commit. |
| `activeProfile` | `local`, `cloud`, `staging`, `custom` | Selected backend profile. |
| `storyId` | story UUID or short ID | Active delivery context. |
| `guidanceProfile` | `beginner`, `intermediate`, `advanced`, `expert` | Controls explanation depth. |
| `routingMode` | `local`, `hybrid`, `cloud` | Model routing preference. |
| `sidecar.enabled` | boolean | Enables local MCP bridge/watcher. |
| `rules.autoSync` | boolean | Regenerates rules when story/rules change. |

Editor-specific settings may prefix these keys, for example `aisha.apiBaseUrl` in Zed.

## File contracts

### `.aisha/story.json`

Shared active story bridge.

```json
{
  "story_id": "<story-id>",
  "updated_at": "<iso timestamp>"
}
```

Rules:

- `story_id` is required.
- `updated_at` must be an ISO timestamp.
- Editors and CLI tools may read/write this file.
- A writer should preserve unknown future fields.

### `.aisha/session.json`

Local session and orchestration state.

Recommended shape:

```json
{
  "session_id": "<uuid>",
  "story_id": "<story-id>",
  "workspace_path": "<absolute-or-redacted-path>",
  "status": "active",
  "work_phase": "implementation",
  "active_profile": "local",
  "routing_mode": "hybrid",
  "updated_at": "<iso timestamp>"
}
```

Rules:

- Treat as local/session state, not durable project truth.
- Do not store provider keys, service keys, raw JWTs, or PII.
- Preserve unknown future fields.

### `.aisha/dirigent.json`

Tracked, non-secret project defaults.

Allowed content:

- default profile name,
- non-secret API/MCP endpoint defaults,
- guidance/routing defaults,
- dashboard/deep-link URLs,
- rules auto-sync preference,
- non-secret project metadata.

Forbidden content:

- client tokens,
- service-role keys,
- provider API keys,
- user access tokens,
- private customer credentials.

### `.aisha/dirigent.local.json`

Per-user local configuration. This file must remain untracked.

Allowed content:

- local/cloud/custom profile overrides,
- local endpoints,
- client token,
- selected story/profile,
- generated local preferences.

## MCP tool contract

Canonical AISHA tools expected by editor clients:

| Tool | Purpose |
|---|---|
| `suggest_next_step` | Delivery next-step recommendation. |
| `moderate_flow` | Higher-level orchestration and risk moderation. |
| `assess_quality` | Code/design quality review. |
| `evaluate_tests` | Test strategy and test result evaluation. |
| `check_pr_compliance` | Compliance with project, story, and PR rules. |
| `estimate_effort` | Effort/risk estimate. |
| `get_story_context` | Active story context and delivery constraints. |
| `search_knowledge` | Knowledge/rules lookup. |
| `route_task` | Model/provider/task routing. |

Sidecars may add local helper tools, but helper tools must be clearly prefixed.

Current Zed/ZEDBENCH helper tools:

| Tool | Purpose |
|---|---|
| `aisha_connect` | First setup/update for profile, Runtime API, MCP, story, routing, dashboard, and rules. |
| `aisha_health` | Health check for bridge, profile, story, `.rules`, local config, and remote MCP. |
| `aisha_repair_mcp` | Repair local config and optionally regenerate `.rules`. |
| `aisha_get_profile` | Return redacted profile state. |
| `aisha_set_profile` | Switch backend profile. |
| `aisha_set_routing_mode` | Switch model routing mode. |
| `aisha_get_story` | Read active story context. |
| `aisha_set_story` | Write `.aisha/story.json`. |
| `aisha_open_dashboard` | Return dashboard/story/health link. |
| `aisha_build_dirigent_brief` | Build a local brief from workspace/git/profile/story state. |
| `aisha_queue_dirigent_brief` | Persist a pending brief under `.aisha/briefs`. |
| `aisha_list_dirigent_briefs` | List queued briefs. |
| `aisha_sync_rules` | Regenerate `.rules`. |
| `aisha_start_watcher` / `aisha_stop_watcher` | Manage lightweight local sidecar watchers. |
| `aisha_model_routing_status` | Inspect local routing state and route-task availability. |

## Sidecar security boundary

An AISHA IDE sidecar may:

- read local workspace files needed for context,
- read `.aisha/*` configuration files,
- inspect git branch/status/diff,
- call AISHA Runtime API and AISHA MCP,
- write local generated artifacts such as `.rules`,
- cache non-sensitive session state.

An AISHA IDE sidecar must not:

- connect directly to Postgres,
- use service-role credentials,
- depend on table names or database schemas,
- bypass AISHA Runtime/MCP authorization,
- commit or print secrets,
- silently downgrade high-risk actions to unaudited local behavior.

## Generated instruction artifacts

Current shared adapters include:

| Adapter | Output |
|---|---|
| `copilot` | `.github/copilot-instructions.md` |
| `agents` | `AGENTS.md` |
| `claude` | `CLAUDE.md` |
| `cursorrules` | `.cursorrules` |
| `windsurfrules` | `.windsurfrules` |
| `zedrules` | `.rules` |
| `aisha-agent` | `.github/agents/AISHA.agent.md` |
| `codex-skill` | `codex/skills/aisha-dirigent-autopilot/SKILL.md` |

Generated files must include the AISHA auto-generation marker and metadata footer so gates can detect stale or manually edited artifacts.

## Shared core package

`packages/dirigent-core` is the editor-neutral home for contracts that must be maintained once and reused by VS Code Dirigent, Zed Dirigent, bridge sidecars, and future AISHA ZEDBENCH.

Initial exported contracts:

- profile and routing mode constants;
- workspace root detection;
- `.aisha` path resolution;
- JSON read/write helpers for local contract files;
- `.aisha/story.json` read/write;
- `.aisha/dirigent.json` + `.aisha/dirigent.local.json` profile resolution;
- secret-redacted config projection;
- local config update helper.
