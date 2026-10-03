---
description: List improvement proposals from the AISHA self-learning loop (backend MCP tool get_improvement_proposals).
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_proposals
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_proposals` tool from the **aisha-dirigent** MCP server.

List improvement proposals from the AISHA self-learning loop (backend MCP tool get_improvement_proposals). Optionally filter by status. Requires a configured backend.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
