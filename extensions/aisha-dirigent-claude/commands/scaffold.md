---
description: Author a project-tailored Claude Code artifact (skill | hook | command | agent) into .claude/, pre-filled with project context.
argument-hint: "[json arguments]"
allowed-tools: mcp__aisha-dirigent__aisha_scaffold
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

Use the `aisha_scaffold` tool from the **aisha-dirigent** MCP server.

Author a project-tailored Claude Code artifact (skill | hook | command | agent) into .claude/, pre-filled with project context. Defaults to a preview; set apply=true to write. Refuses to clobber an existing same-slug artifact unless overwrite=true (safest default — protects user content). For kind=hook, also deep-merges an entry into .claude/settings.json, preserving all user keys.

If the user passed arguments, forward them to the tool as JSON: $ARGUMENTS

Then summarize the result for the user and call out anything actionable (uncommitted seed/migration changes, over-budget routing, offline services, stale rules).
