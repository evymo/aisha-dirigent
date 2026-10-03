---
description: Summarize the project's compliance posture:
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_compliance
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_compliance` tool from the **aisha-dirigent** MCP server.

Summarize the project's compliance posture: active security/testing rule categories, the available compliance gate commands, and the enterprise source-onboarding mandate. Optionally run a specific gate (set run + gate).

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
