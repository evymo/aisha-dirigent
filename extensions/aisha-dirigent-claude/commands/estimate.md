---
description: Estimate the USD cost of a task across the router slot profiles, from a token count and the per-slot model mapping in .aisha/dirigent.template.json.
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_estimate
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_estimate` tool from the **aisha-dirigent** MCP server.

Estimate the USD cost of a task across the router slot profiles, from a token count and the per-slot model mapping in .aisha/dirigent.template.json. Heuristic (blended prices); for planning, not billing.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
