---
description: Recommend an LLM tier/model for a task using the Dirigent router-coach slot profiles in .aisha/dirigent.template.json.
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_route
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_route` tool from the **aisha-dirigent** MCP server.

Recommend an LLM tier/model for a task using the Dirigent router-coach slot profiles in .aisha/dirigent.template.json.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
