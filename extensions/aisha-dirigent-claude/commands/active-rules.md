---
description: Contextual rule subset Dirigent currently applies (by category).
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_active_rules
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_active_rules` tool from the **aisha-dirigent** MCP server.

Contextual rule subset Dirigent currently applies (by category). Reads .aisha/active-rules.json. Optionally filter by category.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
