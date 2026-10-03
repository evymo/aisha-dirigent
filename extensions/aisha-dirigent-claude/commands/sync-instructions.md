---
description: Regenerate IDE instruction files from the AISHA ruleset (the Dirigent `gen:ide` pipeline):
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_sync_instructions
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_sync_instructions` tool from the **aisha-dirigent** MCP server.

Regenerate IDE instruction files from the AISHA ruleset (the Dirigent `gen:ide` pipeline): CLAUDE.md, .cursorrules, copilot-instructions, claude-overlay, and this claude-app. Defaults to a dry run; set apply=true to write files.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
