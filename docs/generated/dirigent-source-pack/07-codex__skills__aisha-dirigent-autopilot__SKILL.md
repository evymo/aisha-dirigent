---
name: aisha-dirigent-autopilot
description: Hybrid Aisha/Codex autopilot for the AISHA platform. Use for planning, compliance, quality, testing, deployment gates, and workspace orchestration with remote-first routing and deterministic local fallback.
---

# AISHA Dirigent Autopilot

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via `npm run gen:ide`.
> Generated: 2026-04-05 06:24:33.870009+00
## Core rules

- Treat `AGENTS.md` as the policy source.
- Prefer Aisha for planning, routing, and compliance when remote services are healthy.
- Fall back to local CLI checks immediately when MCP or n8n is unavailable.
- Use `smoke` lane for in-flight work and `full` lane for merge, deploy, or autonomous release actions.
- Stop on failed gates and return the audit trace instead of continuing silently.

## Default workflow

1. Run `aisha-health --json`.
2. If remote checks pass, delegate intent with `aisha-dirigent "<task>"`.
3. Use `aisha-next`, `aisha-quality`, and `aisha-test --lane smoke|full` to execute the loop.
4. Use `aisha-db <status|migrate|types|reset>` for DB work.
5. Use `aisha-deploy --dry-run` before any trusted deploy.

## Platform rules

MANDATORY rules for all AISHA platform code:
1. Hook-Only Data Access — API calls ONLY from custom hooks
2. No any types — use proper TypeScript types or unknown + type guard
3. Zod Validation — all external data MUST pass Zod schema
4. i18n for all UI text — use t("key"), no hardcoded strings
5. No console.log — use safeError()
6. No emoji in UI — use lucide-react icons
7. RPC-Only — no direct .from() queries

## Testing

Testing Rules:
- Run ONLY relevant tests: npm run test:run -- src/tests/hooks/useMyHook.test.ts
- NEVER run all tests unless pre-PR
- Mock MUST match implementation
- Use vi.mocked(supabase.rpc) consistently

## Workflows

Migration Rules:
1. Create: supabase/migrations/YYYYMMDDHHMMSS_description.sql
2. Register: npm run db:migration:register
3. Apply: npm run db:migrate:local
4. Types: npm run db:types:gen:local
5. Verify: npx tsc --noEmit
NEVER archive migrations!

## Bootstrap

- Generate local config: `npm run dirigent:bootstrap`
- Generate local MCP config too: `npm run dirigent:bootstrap:mcp`
- Refresh generated IDE instructions: `npm run gen:ide`
- Refresh the generated source pack: `npm run dirigent:source-pack`
- Install this skill into Codex: `npm run dirigent:skill:install`

## References

- `references/control-plane.md`
- `references/commands.md`
- `references/workflow-lanes.md`

<!-- gen:metadata {"story_id":null,"output_path":"codex/skills/aisha-dirigent-autopilot/SKILL.md","length_chars":null,"adapter":"codex-skill","payload_version":1,"fingerprint":null,"generated_at":"2026-04-05 06:24:33.870009+00"} -->
