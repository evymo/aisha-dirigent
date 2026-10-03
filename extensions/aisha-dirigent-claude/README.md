# AISHA Dirigent — Claude app (v0.7.0)

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

AISHA Dirigent for Claude — governance rules, seed/merge tracking, model routing, health, and local-LLM cost/usage, exposed as MCP tools.

This single directory is **two installable artifacts** from one source:

1. **Claude Code plugin** — `.claude-plugin/plugin.json` + `commands/`, `skills/`, `agents/`, `hooks/`, `.mcp.json`.
2. **Claude Desktop Extension (MCPB)** — `manifest.json` + bundled `server/` (packaged to `.mcpb`).

Both run the same local, zero-dependency MCP server in `server/`.

## Install — Claude Code (plugin)

```bash
# from a marketplace that lists this repo, or for local dev:
claude plugin install ./extensions/aisha-dirigent-claude
```

The plugin's `.mcp.json` launches the server with `AISHA_WORKSPACE=${CLAUDE_PROJECT_DIR}`, so it reads the project you have open.

## Install — Claude Desktop (.mcpb)

```bash
npm run package:claude-app      # builds dist/claude-app/aisha-dirigent.mcpb
```

Then double-click the `.mcpb`, or Settings → Extensions → Install, and pick your AISHA workspace folder when prompted.

## Tools (26)

| Tool | Purpose |
| --- | --- |
| `aisha_session` | Current Dirigent session: |
| `aisha_story` | Active story / development direction: |
| `aisha_decisions` | Recent Dirigent decisions / reports captured in .aisha/reports (routing choices, gate outcomes, proposals). |
| `aisha_active_rules` | Contextual rule subset Dirigent currently applies (by category). |
| `aisha_ruleset` | Ruleset fingerprint, context profile, expertise level and active LLM slot profile. |
| `aisha_sync_instructions` | Regenerate IDE instruction files from the AISHA ruleset (the Dirigent `gen:ide` pipeline): |
| `aisha_seed_status` | Database seed tracking: |
| `aisha_merge_status` | Git merge / branch tracking: |
| `aisha_db_convergence` | Migration / schema convergence tracking: |
| `aisha_models` | Discover local LLM models from OpenAI-compatible endpoints (Ollama, Docker Model Runner, LM Studio, vLLM) and show the configured slot profiles. |
| `aisha_route` | Recommend an LLM tier/model for a task using the Dirigent router-coach slot profiles in .aisha/dirigent.template.json. |
| `aisha_cost_usage` | Cost / token usage overview: |
| `aisha_feed` | Recent Dirigent activity / communication feed assembled from .aisha state: |
| `aisha_health` | Environment health: |
| `aisha_bringup` | Bring up the local AISHA stack via the shared entry-point `npm run stack:bringup` (non-interactive, health-gated, JSON output) when no backend is reachable. |
| `aisha_scan_env` | Scan the workspace: |
| `aisha_overlay_plan` | Preview what the AISHA backend would compose for this project: |
| `aisha_compose_overlay` | Compose Claude Code artifacts for this project via the AISHA gen:ide pipeline (backend-parameterized: |
| `aisha_scaffold` | Author a project-tailored Claude Code artifact (skill | hook | command | agent) into .claude/, pre-filled with project context. |
| `aisha_compliance` | Summarize the project's compliance posture: |
| `aisha_estimate` | Estimate the USD cost of a task across the router slot profiles, from a token count and the per-slot model mapping in .aisha/dirigent.template.json. |
| `aisha_onboard` | Summarize the enterprise source-onboarding process (classification, consent, namespace ACL, approval flow) from the project's onboarding contract + handbook. |
| `aisha_proposals` | List improvement proposals from the AISHA self-learning loop (backend MCP tool get_improvement_proposals). |
| `aisha_spend_pending` | List agent runs blocked awaiting spend approval (PostgREST rpc list_pending_spend_approvals). |
| `aisha_spend_approve` | Approve a blocked spend run (PostgREST rpc approve_task_spend_audited). |
| `aisha_spend_reject` | Reject a blocked spend run (PostgREST rpc reject_task_spend_audited). |

## Regenerate

This packaging layer is generated. Edit the server (`server/*.mjs`) or the adapter
(`scripts/ide-adapters/adapter-claude-app.mjs`), then:

```bash
npm run gen:ide -- --format=claude-app   # regenerate manifests + commands
npm run package:claude-app               # rebuild the .mcpb bundle
```
