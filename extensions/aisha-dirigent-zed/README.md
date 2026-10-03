# AISHA Dirigent for Zed

AISHA Dirigent for Zed is the stock-Zed entrypoint for AISHA ZEDBENCH. It registers an AISHA MCP context server for the Zed Agent Panel and starts the local AISHA MCP stdio bridge.

## What this skeleton provides

- `extension.toml` with `[context_servers.aisha-knowledge]`
- Rust/WASM extension crate using `zed_extension_api`
- `context_server_command` that launches the AISHA bridge through Node
- local development override through `AISHA_ZED_BRIDGE_PATH`
- MCP helper tools for setup/connect, health/repair, story, routing, dashboard links, rules sync, and Dirigent Brief queue
- no committed secrets or backend credentials

## Expected bridge locations

The extension resolves the bridge in this order:

1. `AISHA_ZED_BRIDGE_PATH`
2. `server/aisha-mcp-stdio-bridge.mjs` bundled inside this extension
3. `../../server/aisha-mcp-stdio-bridge.mjs` when running from this monorepo as a dev extension

The bridge is intentionally a separate layer. It owns MCP stdio handling, profile resolution, health checks, story/session file access, Dirigent Brief queueing, and forwarding to AISHA Runtime/MCP.

## Agent Panel tools

The bridge exposes these local AISHA tools in addition to canonical remote AISHA MCP tools:

| Tool | Purpose |
|---|---|
| `aisha_connect` | First setup/update of profile, Runtime API, MCP URL, story, routing, dashboard, and rules. |
| `aisha_health` | Check bridge, profile, story, `.rules`, config, and remote MCP reachability. |
| `aisha_repair_mcp` | Repair missing local config and optionally regenerate `.rules`. |
| `aisha_set_profile` | Switch `local`, `cloud`, `staging`, or `custom`. |
| `aisha_set_story` | Persist `.aisha/story.json`. |
| `aisha_set_routing_mode` | Switch `local`, `hybrid`, or `cloud` routing. |
| `aisha_sync_rules` | Regenerate Zed `.rules`. |
| `aisha_queue_dirigent_brief` | Create a pending brief in `.aisha/briefs`. |
| `aisha_open_dashboard` | Return dashboard/story/health deep link. |

Prompt equivalents such as `aisha-next`, `aisha-quality`, `aisha-test`, `aisha-compliance`, `aisha-health`, `aisha-route`, and `aisha-onboard` are exposed through MCP prompts for Zed Agent Panel use.

## Local development

Build the extension crate:

```bash
cargo check --manifest-path extensions/aisha-dirigent-zed/Cargo.toml
```

Install this directory as a Zed dev extension, then verify that the `AISHA Knowledge` context server appears in the Agent Panel MCP server list.

For a custom bridge path:

```bash
export AISHA_ZED_BRIDGE_PATH=/absolute/path/to/aisha-mcp-stdio-bridge.mjs
```

## Configuration boundary

Zed-facing configuration should use AISHA Runtime vocabulary:

- `aisha.apiBaseUrl`
- `aisha.mcpUrl`
- `aisha.clientToken`
- `aisha.activeProfile`
- `aisha.storyId`
- `aisha.guidanceProfile`
- `aisha.routingMode`
- `aisha.sidecar.enabled`
- `aisha.rules.autoSync`

Do not expose Postgres, Supabase, service-role keys, table names, or direct database access in the Zed extension UX. The extension starts the bridge; the bridge talks only to AISHA Runtime API and AISHA MCP contracts.

## Shared core

The bridge consumes `packages/dirigent-core` for editor-neutral contracts:

- workspace root detection
- `.aisha/story.json` read/write
- `.aisha/dirigent*.json` profile resolution
- local config updates
- redacted profile output

This is the first shared layer intended for later reuse by VS Code Dirigent and AISHA ZEDBENCH.
