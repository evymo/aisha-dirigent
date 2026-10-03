---
description: Approve a blocked spend run (PostgREST rpc approve_task_spend_audited).
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_spend_approve
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_spend_approve` tool from the **aisha-dirigent** MCP server.

Approve a blocked spend run (PostgREST rpc approve_task_spend_audited). Previews by default; set apply=true to execute. Backend RLS still enforces admin/staff.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
