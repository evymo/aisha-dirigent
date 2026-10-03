-- ============================================================================
-- STEP 35: AISHA Platform Self-Knowledge (runtime governance + DB lifecycle)
-- Source of truth: hand-authored from the docs/architecture/ invariant docs.
-- AISHA-retrievable self-knowledge about its OWN runtime: story_id = NULL
-- (platform-global -> returns for every story via mcp_search_knowledge_v2),
-- visibility 'public', item_type 'engineering_doc'. Mirrors the hand-authored
-- engineering_doc rows in 21_aisha_knowledge.sql. Chunks + embeddings are NOT
-- seeded — they are derived at runtime by trg_knowledge_embedding_auto +
-- WF_EMBEDDING_REFRESH (embedding is model-dependent + safety-scanned by design).
-- Stable UUIDs + ON CONFLICT (id) DO NOTHING => idempotent across re-seeds.
-- ============================================================================

-- (1) How AISHA launches + governs its own CLI agent instances (PR #507).
INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_slug,
    title, summary, body_markdown, ai_instructions,
    ai_context_tags, category, expertise_area_id, status, visibility, version,
    author_id, author_display_name, usage_count, rating_avg, is_verified, published_at, created_at, updated_at
) VALUES (
    'cb000000-0c11-0000-0000-c11000000001',
    'engineering_doc',
    'manual',
    'aisha-self-governed-cli-run-lifecycle',
    'AISHA Self-Governed CLI Run Lifecycle',
    'How the stack launches + governs its OWN headless CLI agent instances (Claude Code CLI, OpenAI Codex CLI) as a first-class governed runtime: resolve -> admit (4 axes) -> ask/hold -> approve -> journal (I1) -> spawn -> result contract. Nothing tool-specific is hardcoded; selection is derived from ai_runtime_registry rows.',
    E'# AISHA Self-Governed CLI Run Lifecycle\n\n'
    || E'AISHA spawns and supervises its OWN headless CLI agents (not a human in an IDE) to do real work (file edits, git, web) under the SAME governance every other dispatch goes through. One runner, one result contract, N CLI tools.\n\n'
    || E'## The runtime axis\n'
    || E'A CLI tool is a runtime addressed by slug `cli:<tool>` (`cli:claude-cli`, `cli:codex-cli`), registered as a row in `ai_runtime_registry`. Selection is DERIVED, never hardcoded:\n'
    || E'- `fn_resolve_runtime(clow)` derives a CLI only with explicit `runtime=cli` + `cli_slug`, and only while the row is `is_enabled=true` AND `is_in_process_executor=true`. Toggle the row -> resolution changes. No allow-list of tool names exists.\n'
    || E'- Capability columns (`can_write`, `needs_network`, `supports_tools`) exclude a runtime that cannot satisfy a need. Adding a second CLI tool is a SEED ROW, not code.\n\n'
    || E'## The governed dispatch path\n'
    || E'1. **Admission** — `fn_admit_clow(p_clow, p_context)` composes a verdict over four derived axes: spend (`fn_authorize_task_spend`), runtime availability (`fn_runtime_available`), capability match, risk (`fn_compute_clow_risk`). Verdict precedence: `deny > ask > allow`.\n'
    || E'2. **Risk** — a CLI run is irreversible + egressing + writing, so risk is rated CRITICAL; under the built-in `ask@medium` policy that resolves to `ask`.\n'
    || E'3. **Hold for approval** — an `ask` verdict creates the run HELD (`approval_required=true`, `approved_at=NULL`, `awaiting=approval`). `claim_queued_claude_run` skips held runs; nothing executes until a human with the right role calls `approve_claude_run` (admin/staff + segregation of duties — approver != requester). `list_pending_claude_approvals` is the Mission Control inbox.\n'
    || E'4. **Journal (I1)** — `fn_record_execution_decision` is the ONLY writer of `ai_decisions`; the run is threaded onto its `decision_id` so verdict + chosen `cli_slug` + outcome are auditable.\n'
    || E'5. **Spawn** — `svc-agent-runner` runs the tool in an isolated container against a per-run worktree via `docker/agent-{claude,codex}` entrypoints.\n'
    || E'6. **Result contract** — both entrypoints emit the SAME `{"__result":true,...}` stdout sentinel from an EXIT trap (survives a failed commit/timeout); the runner validates it and persists `outputs`. Nothing tool-specific leaks into the runner.\n\n'
    || E'## Health is global, not config-presence\n'
    || E'`ai_runtime_registry.adapter_health` is written ONLY by `WF_RUNTIME_HEALTH_PROBE` (HTTP-probes svc-agent-runner /health, cross-server via mesh). A process must never self-register its own health from config presence.\n\n'
    || E'## Why\n'
    || E'The CLI is not a side-channel: it is the same resolve -> admit -> journal -> health path as `direct_llm`, `openclaw`, `hermes`. Capability-availability (registry rows), no allow-lists; approval where the blast radius warrants it (mirrors the `playwright_runs` approval pattern).\n',
    'When reasoning about how AISHA runs or governs its own CLI/agent instances (Claude Code CLI, Codex CLI, agent_runs, approvals), use this lifecycle: fn_resolve_runtime derives cli:<slug>, fn_admit_clow gives a 4-axis verdict, ask => held run pending approve_claude_run, fn_record_execution_decision journals it. Selection is registry-derived (ai_runtime_registry), never hardcoded. Do not invent an allow-list of tools.',
    ARRAY['aisha','runtime','cli','claude-cli','codex-cli','agent-runs','admission','approval','governance','capability-availability','self-runtime']::text[],
    'runtime_governance',
    NULL,
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-06-25T00:00:00+00:00',
    '2026-06-25T00:00:00+00:00',
    '2026-06-25T00:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;

-- (2) The heals.sql upgrade-path ordering invariant (existing-DB redeploy safety).
INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_slug,
    title, summary, body_markdown, ai_instructions,
    ai_context_tags, category, expertise_area_id, status, visibility, version,
    author_id, author_display_name, usage_count, rating_avg, is_verified, published_at, created_at, updated_at
) VALUES (
    'cb000000-0c12-0000-0000-c11000000002',
    'engineering_doc',
    'manual',
    'heals-upgrade-path-ordering-invariant',
    'heals.sql Upgrade-Path Ordering Invariant',
    'How an existing AISHA database is upgraded in place via heals.sql, and the ordering rule a fresh-DB test suite cannot catch: every statement referencing a column MUST come AFTER its ADD COLUMN IF NOT EXISTS. Only verify-upgrade-apply.sh (regress -> re-heal -> seed) catches a violation.',
    E'# heals.sql Upgrade-Path Ordering Invariant\n\n'
    || E'## Two apply paths\n'
    || E'AISHA builds its schema from a source-of-truth tree concatenated into one baseline. `migrate.mjs` does different things by DB state:\n'
    || E'- **Fresh DB** -> applies the baseline once (every CREATE TABLE has every column).\n'
    || E'- **Existing DB** -> the baseline is recorded with a NULL checksum and is NEVER re-applied; only `aisha/db/heals.sql` runs, every redeploy. heals is the in-place upgrade mechanism (idempotent reconcile up to the current SoT).\n\n'
    || E'Because the ~15 "Baseline-only state" gates forbid net-new delta migrations, a change folded into the baseline reaches EXISTING databases ONLY via heals.sql (or a destructive --wipe).\n\n'
    || E'## The invariant\n'
    || E'**heals.sql runs top-to-bottom on an existing (possibly old) DB. Every statement that references a column/table/policy MUST appear AFTER the `ADD COLUMN IF NOT EXISTS` / `CREATE ... IF NOT EXISTS` that guarantees it.** Each heals statement must be individually idempotent (IF NOT EXISTS, CREATE OR REPLACE, guarded UPDATE ... WHERE).\n\n'
    || E'## Why a fresh-DB test cannot catch a violation\n'
    || E'On a fresh DB the baseline already created the column, so a heals statement referencing it works wherever it sits. The bug is invisible to `test:db` and every cold-start-from-scratch test; it only surfaces on a real existing DB (a production redeploy) where that column did not yet exist.\n\n'
    || E'## The gate that catches it\n'
    || E'`scripts/db/verify-upgrade-apply.sh`: build a probe DB -> REGRESS it to a pre-fold state (drop the surface heals reconciles) -> re-run migrate.mjs (no-pending -> heals.sql, the prod-redeploy path) -> apply the real seed. A reference-before-ADD bug fails this gate red instead of in production.\n\n'
    || E'## Worked example\n'
    || E'A reconcile `UPDATE ai_runtime_registry SET ... WHERE slug=''cli:claude-cli'' AND is_in_process_executor=false` was placed ~500 lines BEFORE the `ADD COLUMN IF NOT EXISTS is_in_process_executor`. Fresh DBs stayed green; the upgrade probe failed `column "is_in_process_executor" does not exist`. Fix: move the UPDATE to AFTER the column-backfill block.\n\n'
    || E'## Checklist before editing heals.sql\n'
    || E'- Does every column/table/policy this statement names get ADDed/CREATEd earlier in the file? If not, move it down (or the ADD up).\n'
    || E'- Is it idempotent on a re-run against an arbitrary prior state?\n'
    || E'- A CREATE OR REPLACE FUNCTION whose SIGNATURE changed needs a DROP FUNCTION IF EXISTS (old-sig) first.\n'
    || E'- Verify with `bash scripts/db/verify-upgrade-apply.sh`, not just `test:db`.\n',
    'When editing aisha/db/heals.sql, or diagnosing a "column/relation does not exist" error that appears only on an existing-DB redeploy (not on a fresh cold-start), apply this ordering invariant: every reference must come AFTER its ADD COLUMN IF NOT EXISTS, statements must be idempotent, and verification needs verify-upgrade-apply.sh (regress -> re-heal), not just test:db.',
    ARRAY['aisha','heals','migration','baseline','upgrade-path','cold-start','redeploy','idempotent','database','invariant']::text[],
    'platform_architecture',
    NULL,
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-06-25T00:00:00+00:00',
    '2026-06-25T00:00:00+00:00',
    '2026-06-25T00:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;
