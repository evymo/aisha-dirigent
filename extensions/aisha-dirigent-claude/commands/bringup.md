---
description: Bring up the local AISHA stack via the shared entry-point `npm run stack:bringup` (non-interactive, health-gated, JSON output) when no backend is reachable.
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_bringup
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_bringup` tool from the **aisha-dirigent** MCP server.

Bring up the local AISHA stack via the shared entry-point `npm run stack:bringup` (non-interactive, health-gated, JSON output) when no backend is reachable. Spawns the bring-up in the workspace, parses the final JSON status line, and returns { healthy, gatewayUrl, services }. Use after aisha_health reports the backend unreachable. Pass dryRun=true to see the exact command (and expected gateway) without starting anything.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
