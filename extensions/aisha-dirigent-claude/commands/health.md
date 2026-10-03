---
description: Environment health:
allowed-tools: mcp__aisha-dirigent__aisha_health
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_health` tool from the **aisha-dirigent** MCP server.

Environment health: runtime versions, required CLIs present, .aisha config presence, and reachability of the configured AISHA backend.

This tool takes no arguments.

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
