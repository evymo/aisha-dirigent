---
name: aisha-dirigent
description: AISHA Dirigent for Claude — governance rules, seed/merge tracking, model routing, health, and local-LLM cost/usage, exposed as MCP tools. Use whenever working inside an AISHA project (a .aisha/ folder is present) — to check governance rules before edits, track seeds/merges/migrations, choose an LLM tier via the router-coach, check health, or review local-LLM availability and cost.
---

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide -- --format=claude-app`.

# AISHA Dirigent

This skill operates **AISHA Dirigent** from Claude via the local `aisha-dirigent` MCP server. 
It is the Claude-native counterpart of the AISHA Dirigent VS Code / Zed extensions: same governance overlay, exposed as tools.

## When to use

- Before committing, merging, or seeding: check `aisha_merge_status`, `aisha_seed_status`, `aisha_db_convergence`.
- Before a costly LLM task: ask `aisha_route` / `aisha_models` for the right tier and whether a local model is online.
- When unsure of project rules: `aisha_active_rules` (optionally by category) and `aisha_ruleset`.
- To orient at session start or when asked about status: `aisha_session`, `aisha_story`, `aisha_feed`, `aisha_health`.
- To regenerate IDE instruction files (CLAUDE.md, overlay, etc.): `aisha_sync_instructions` (dry-run by default; pass apply=true to write).
- To compose Claude artifacts for the project: `aisha_overlay_plan` (preview what the backend would emit), `aisha_compose_overlay` (generate the overlay / CLAUDE.md / app — backend-parameterized by story & domain), `aisha_scaffold` (author a new skill/hook/command/agent into .claude/).

## AISHA Runtime Contract

- Treat AISHA Gateway as the only app-facing backend surface: `/rest/v1/rpc/*`, `/functions/v1/*`, `/admin/*`, and MCP URLs from `.well-known/app-config.json`.
- Use `@aisha/api-core`, generated RPC types, and `api.rpc(...)` / `api.invoke(...)` contracts. Do not create parallel raw Supabase/Postgres clients in editor plugins or mobile/desktop shells.
- Bring up local services with `npm run stack:bringup`; run `npm run gen:ide` after runtime, env, or rule changes so Cursor/Windsurf/Zed/Claude/Codex surfaces stay aligned.
- Plugin execution is isolated through `svc-plugin-system` and `svc-agent-runner`; broker tokens require `BROKER_TOKEN_SECRET` and plugin LLM calls must go through `/functions/v1/ai-generate`, not vendor APIs.
- Environment and dynamic functions are generated from `config/local-presets.mjs`, `scripts/render-app-config.mjs`, `scripts/local-compose-gen.mjs`, and gateway `ROUTE_TABLE`. Add a route/table/env entry before referencing a new function.

## Tools

| MCP tool | Slash command | Purpose |
| --- | --- | --- |
| `aisha_session` | /aisha-dirigent:session | Current Dirigent session: |
| `aisha_story` | /aisha-dirigent:story | Active story / development direction: |
| `aisha_decisions` | /aisha-dirigent:decisions | Recent Dirigent decisions / reports captured in .aisha/reports (routing choices, gate outcomes, proposals). |
| `aisha_active_rules` | /aisha-dirigent:active-rules | Contextual rule subset Dirigent currently applies (by category). |
| `aisha_ruleset` | /aisha-dirigent:ruleset | Ruleset fingerprint, context profile, expertise level and active LLM slot profile. |
| `aisha_sync_instructions` | /aisha-dirigent:sync-instructions | Regenerate IDE instruction files from the AISHA ruleset (the Dirigent `gen:ide` pipeline): |
| `aisha_seed_status` | /aisha-dirigent:seed-status | Database seed tracking: |
| `aisha_merge_status` | /aisha-dirigent:merge-status | Git merge / branch tracking: |
| `aisha_db_convergence` | /aisha-dirigent:db-convergence | Migration / schema convergence tracking: |
| `aisha_models` | /aisha-dirigent:models | Discover local LLM models from OpenAI-compatible endpoints (Ollama, Docker Model Runner, LM Studio, vLLM) and show the configured slot profiles. |
| `aisha_route` | /aisha-dirigent:route | Recommend an LLM tier/model for a task using the Dirigent router-coach slot profiles in .aisha/dirigent.template.json. |
| `aisha_cost_usage` | /aisha-dirigent:cost-usage | Cost / token usage overview: |
| `aisha_feed` | /aisha-dirigent:feed | Recent Dirigent activity / communication feed assembled from .aisha state: |
| `aisha_health` | /aisha-dirigent:health | Environment health: |
| `aisha_bringup` | /aisha-dirigent:bringup | Bring up the local AISHA stack via the shared entry-point `npm run stack:bringup` (non-interactive, health-gated, JSON output) when no backend is reachable. |
| `aisha_scan_env` | /aisha-dirigent:scan-env | Scan the workspace: |
| `aisha_overlay_plan` | /aisha-dirigent:overlay-plan | Preview what the AISHA backend would compose for this project: |
| `aisha_compose_overlay` | /aisha-dirigent:compose-overlay | Compose Claude Code artifacts for this project via the AISHA gen:ide pipeline (backend-parameterized: |
| `aisha_scaffold` | /aisha-dirigent:scaffold | Author a project-tailored Claude Code artifact (skill | hook | command | agent) into .claude/, pre-filled with project context. |
| `aisha_compliance` | /aisha-dirigent:compliance | Summarize the project's compliance posture: |
| `aisha_estimate` | /aisha-dirigent:estimate | Estimate the USD cost of a task across the router slot profiles, from a token count and the per-slot model mapping in .aisha/dirigent.template.json. |
| `aisha_onboard` | /aisha-dirigent:onboard | Summarize the enterprise source-onboarding process (classification, consent, namespace ACL, approval flow) from the project's onboarding contract + handbook. |
| `aisha_proposals` | /aisha-dirigent:proposals | List improvement proposals from the AISHA self-learning loop (backend MCP tool get_improvement_proposals). |
| `aisha_spend_pending` | /aisha-dirigent:spend-pending | List agent runs blocked awaiting spend approval (PostgREST rpc list_pending_spend_approvals). |
| `aisha_spend_approve` | /aisha-dirigent:spend-approve | Approve a blocked spend run (PostgREST rpc approve_task_spend_audited). |
| `aisha_spend_reject` | /aisha-dirigent:spend-reject | Reject a blocked spend run (PostgREST rpc reject_task_spend_audited). |

## Editor parity (source: VS Code extension `@aisha` chat commands)

These editor chat sub-commands are mirrored by the tools above; listed for traceability of the auto-conversion.

| Editor command | Description |
| --- | --- |
| @aisha /test | %cmd.test% |
| @aisha /quality | %cmd.quality% |
| @aisha /compliance | %cmd.compliance% |
| @aisha /estimate | %cmd.estimate% |
| @aisha /next | %cmd.next% |
| @aisha /instructions | %cmd.instructions% |
| @aisha /dirigent | %cmd.dirigent% |
| @aisha /route | %cmd.route% |
| @aisha /models | %cmd.models% |
| @aisha /eval | %cmd.eval% |
| @aisha /proposals | %cmd.proposals% |
| @aisha /health | %cmd.health% |
| @aisha /onboard | %cmd.onboard% |
| @aisha /connect-repo | %cmd.connectRepo% |
| @aisha /story | %cmd.story% |
| @aisha /local | %cmd.local% |

## Notes

- Status/read tools are side-effect free. The composing tools (`aisha_sync_instructions`, `aisha_compose_overlay`, `aisha_scaffold`) **write only when `apply=true`** — they preview/dry-run otherwise (Principle of Least Privilege).
- Composition is **backend-parameterized**: `aisha_compose_overlay` drives `gen:ide`, which pulls the ruleset + hook bindings for the active story/domain and emits exactly the artifacts that fit the project.
- Local LLMs (Ollama/Docker/vLLM) incur $0 API cost; `aisha_cost_usage` surfaces config + persisted reports.
- All tools operate on your project's `.aisha/`, `.claude/`, and git state; nothing leaves the machine.
