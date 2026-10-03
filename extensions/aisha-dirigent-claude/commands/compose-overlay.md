---
description: Compose Claude Code artifacts for this project via the AISHA gen:ide pipeline (backend-parameterized:
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_compose_overlay
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_compose_overlay` tool from the **aisha-dirigent** MCP server.

Compose Claude Code artifacts for this project via the AISHA gen:ide pipeline (backend-parameterized: rules + hook bindings for the active story/domain). Defaults to a dry run; set apply=true to write. formats defaults to ['claude-overlay'] and may include 'claude' and 'claude-app'.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
