-- ============================================================================
-- heals.sql — idempotent post-baseline reconcile, applied on EVERY migrate
-- (scripts/db/migrate.mjs runs this after migrations, before the entrypoint's
-- db:seed).
--
-- WHY THIS FILE EXISTS: the generated baseline is NEVER re-applied to an
-- already-initialized DB (markApplied records it with a NULL checksum →
-- drift detection skips it; only the destructive AISHA_DB_FORCE_BASELINE_RESET
-- re-runs it), and registry delta migrations are disallowed by the baseline-
-- only release invariant (~20 gates assert an empty registry). So a post-
-- baseline schema change to an EXISTING table never reaches an existing DB.
-- This file is the non-destructive incremental-update path for that wipe-first
-- model: idempotent DDL (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF
-- EXISTS) that ADDS missing schema on existing DBs and is a NO-OP on fresh
-- DBs (the baseline already created it). Every statement MUST stay idempotent.
--
-- Current contents reconcile the fe939cf1 'agent-activity' schema (folded
-- straight into the baseline + archived as migrations 20260612202007 +
-- 20260612213842) onto DBs created before that fold — the 2026-06-15 prod
-- symptom: db:seed → 'column config of relation claude_hook_bindings does not
-- exist'. Body = verbatim those two idempotent archived deltas + agent_runs.inputs.
-- ============================================================================

-- ─── universalize (9fd1cd8e) column convergence for EXISTING DBs ────────────
-- The universalize pass renamed currency-suffixed columns (*_usd / *_czk →
-- generic) and added per-row `currency` columns across the commerce + AI-cost
-- surface — folded straight into the baseline with NO reconcile for
-- already-initialized DBs. On upgrade, CREATE TABLE IF NOT EXISTS skips the
-- old-shape tables and every downstream statement referencing the new names
-- aborts (first hit: heals' own ai_resolver_policy seed INSERT, idc-studio
-- 2026-07-14). Converge FIRST, before anything below touches these tables:
-- conditional RENAME (preserves data; no-op when already converged or fresh),
-- then ADD COLUMN IF NOT EXISTS for the columns the pass introduced.
DO $$
DECLARE spec text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['ai_batch_jobs','estimated_cost_usd','estimated_cost'],
    ['ai_batch_jobs','actual_cost_usd','actual_cost'],
    ['ai_budget','cost_usd_limit','cost_limit'],
    ['ai_budget','consumed_cost_usd','consumed_cost'],
    ['ai_decisions','estimated_cost_usd','estimated_cost'],
    ['ai_resolver_policy','budget_remaining_floor_usd','budget_remaining_floor'],
    ['ai_resolver_policy','budget_max_cost_usd','budget_max_cost'],
    ['ai_resolver_policy','premium_max_cost_usd','premium_max_cost'],
    ['ai_resolver_policy','default_max_cost_usd','default_max_cost'],
    ['ai_resolver_policy','default_budget_remaining_usd','default_budget_remaining'],
    ['ai_spend_policies','auto_allow_under_usd','auto_allow_under'],
    ['ai_spend_policies','ask_over_usd','ask_over'],
    ['ai_spend_policies','deny_over_usd','deny_over'],
    ['consultation_bookings','price_czk','price'],
    ['currency_rates','rate_to_czk','rate_to_base'],
    ['lab_test_orders','total_price_czk','total_price'],
    ['llm_quota','daily_cost_usd_limit','daily_cost_limit'],
    ['llm_tier_defaults','daily_cost_usd_limit','daily_cost_limit'],
    ['maintenance_contracts','monthly_price_czk','monthly_price'],
    ['payout_ledger','amount_czk','amount'],
    ['production_cost_lines','amount_czk','amount'],
    ['project_revenue','total_amount_czk','total_amount'],
    ['rag_eval_runs','cost_usd','cost'],
    ['revenue_splits','amount_czk','amount'],
    ['specialist_pricing','hourly_rate_czk','hourly_rate']
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = spec[1])
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = spec[1] AND column_name = spec[2])
    THEN
      CONTINUE; -- fresh/already-converged DB — nothing to do
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = spec[1] AND column_name = spec[3])
    THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', spec[1], spec[2], spec[3]);
      RAISE NOTICE 'universalize convergence: %.% -> %', spec[1], spec[2], spec[3];
    ELSE
      -- BOTH columns exist: a heals establishment block ADD COLUMN'd the new
      -- name on a partially-healed DB (heals applies statement-by-statement,
      -- so an aborted earlier run leaves this state) before this convergence
      -- block existed. Backfill, then DROP the superseded old column — while
      -- it lingers, a NOT NULL old column (llm_quota / llm_tier_defaults
      -- daily_cost_usd_limit) rejects every new-shape INSERT, which is how
      -- db:seed died on idc-studio 2026-07-14.
      EXECUTE format('UPDATE public.%I SET %I = %I WHERE %I IS NULL AND %I IS NOT NULL',
                     spec[1], spec[3], spec[2], spec[3], spec[2]);
      EXECUTE format('ALTER TABLE public.%I DROP COLUMN %I', spec[1], spec[2]);
      RAISE NOTICE 'universalize convergence (both-state): %.% backfilled -> % and dropped', spec[1], spec[2], spec[3];
    END IF;
  END LOOP;
END $$;
-- Columns the pass ADDED (CREATE TABLE IF NOT EXISTS never reaches them).
-- `currency` is nullable by SoT design — NULL = commerce_base_currency().
-- Dropped legacy columns (payment_sessions.amount_czk, subscription_packages
-- price_czk/price_usd) stay in place on purpose: non-destructive reconcile,
-- nothing references them anymore.
ALTER TABLE public.lab_test_orders        ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.payout_ledger          ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.production_cost_lines  ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.revenue_splits         ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.blockchain_audit_records ADD COLUMN IF NOT EXISTS record_type text;
-- (workbench_execution_requests.claim_attempts is covered by its own
-- establishment block further down — heals-established table, ordering gate.)
ALTER TABLE public.reward_claims ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.token_transactions(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reward_claims_transaction_id_key') THEN
    ALTER TABLE public.reward_claims ADD CONSTRAINT reward_claims_transaction_id_key UNIQUE (transaction_id);
  END IF;
END $$;

-- ─── the absorbed migration (now in the baseline) ─────────
-- ============================================================================
-- agent_activity_monitoring — universal live-presence lens for agent work
-- ============================================================================
-- Adds the source-dimensioned agent_live_sessions presence registry + the
-- seed-extensible agent_phase_catalog taxonomy, and routes session telemetry
-- into the EXISTING ai_runs/ai_trace_events signal (kind='ide_session',
-- event_type tool_call/task_checkpoint) instead of a parallel event table —
-- anomaly detection, performance snapshots, router coach and cost rollup see
-- IDE activity natively.
--
-- Also extends claude_hook_bindings with scanner_kind 'relay'/'snapshot' and
-- a config jsonb column so the supervisor relay's behaviour (events, phase
-- map, tool derivation) is seed data interpreted by a generated script, not
-- hardcoded logic.
--
-- Source of truth pairs:
--   aisha/db/sql/tables/agent_live_sessions.sql
--   aisha/db/sql/tables/agent_phase_catalog.sql
--   aisha/db/sql/tables/claude_hook_bindings.sql            (config column)
--   aisha/db/sql/functions/fn_upsert_agent_live_session.sql
--   aisha/db/sql/functions/fn_log_agent_session_event.sql
--   aisha/db/sql/functions/list_active_agent_sessions.sql
--   aisha/db/sql/functions/get_agent_phase_catalog.sql
--   aisha/db/sql/functions/list_active_agent_runs.sql       (ide_session excl.)
--   aisha/db/sql/functions/mcp_get_claude_hook_bindings.sql (config in output)
--   aisha/db/seed/core/27_claude_hook_bindings.sql          (moved + relay row)
--   aisha/db/seed/core/28_agent_phase_catalog.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table: agent_phase_catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_phase_catalog (
  slug        text        NOT NULL,
  axis        text        NOT NULL DEFAULT 'activity',
  labels      jsonb       NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (axis, slug),
  CONSTRAINT agent_phase_catalog_labels_has_locales
    CHECK (labels ? 'cs' AND labels ? 'en')
);

COMMENT ON TABLE public.agent_phase_catalog IS
  'Seed-extensible phase taxonomy for agent_live_sessions (axis=activity validated in RPC; axis=pipeline for source-specific detail). UI reads labels via get_agent_phase_catalog().';

ALTER TABLE public.agent_phase_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_phase_catalog auth read" ON public.agent_phase_catalog;
CREATE POLICY "agent_phase_catalog auth read" ON public.agent_phase_catalog
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "agent_phase_catalog service full" ON public.agent_phase_catalog;
CREATE POLICY "agent_phase_catalog service full" ON public.agent_phase_catalog
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS agent_phase_catalog_updated_at ON public.agent_phase_catalog;
CREATE TRIGGER agent_phase_catalog_updated_at
  BEFORE UPDATE ON public.agent_phase_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Table: agent_live_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_live_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       text        NOT NULL,
  source           text        NOT NULL DEFAULT 'claude-code',
  story_id         uuid        REFERENCES public.partner_stories(id) ON DELETE SET NULL,
  user_id          uuid        REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  agent_run_id     uuid        REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  ai_run_id        uuid        REFERENCES public.ai_runs(id) ON DELETE SET NULL,
  branch           text,
  current_phase    text        NOT NULL DEFAULT 'idle',
  phase_detail     text,
  current_task     text,
  last_tool        text,
  last_file        text,
  subagents        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  tokens_estimate  int,
  started_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agent_live_sessions_session_id_unique UNIQUE (session_id)
);

COMMENT ON TABLE public.agent_live_sessions IS
  'Universal live-presence registry for agent work sessions (one upsert row per session_id, source-dimensioned). Realtime-enabled UI surface; history flows to ai_trace_events via the linked ide_session ai_run.';
COMMENT ON COLUMN public.agent_live_sessions.source IS
  'Reporting surface: claude-code | vscode | zed | codex | n8n | container | …. Open text — new sources appear without schema change.';
COMMENT ON COLUMN public.agent_live_sessions.current_phase IS
  'Activity-axis phase validated against agent_phase_catalog (axis=activity) in fn_upsert_agent_live_session — no CHECK so the taxonomy stays seed-extensible.';
COMMENT ON COLUMN public.agent_live_sessions.subagents IS
  'Live sub-agent snapshot [{label, status, started_at, ended_at}] maintained from Agent tool pre/post events; capped at 20.';
COMMENT ON COLUMN public.agent_live_sessions.ai_run_id IS
  'Per-session ai_runs aggregate (kind=ide_session) — ai_trace_events history + finish_ai_run cost rollup hang off this run.';

CREATE INDEX IF NOT EXISTS idx_agent_live_sessions_story
  ON public.agent_live_sessions (story_id)
  WHERE story_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_live_sessions_active
  ON public.agent_live_sessions (updated_at DESC)
  WHERE current_phase <> 'stopped';
CREATE INDEX IF NOT EXISTS idx_agent_live_sessions_source
  ON public.agent_live_sessions (source, updated_at DESC);

ALTER TABLE public.agent_live_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_live_sessions owner read" ON public.agent_live_sessions;
CREATE POLICY "agent_live_sessions owner read" ON public.agent_live_sessions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin_or_staff(auth.uid())
  );

DROP POLICY IF EXISTS "agent_live_sessions service full" ON public.agent_live_sessions;
CREATE POLICY "agent_live_sessions service full" ON public.agent_live_sessions
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS agent_live_sessions_updated_at ON public.agent_live_sessions;
CREATE TRIGGER agent_live_sessions_updated_at
  BEFORE UPDATE ON public.agent_live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- claude_hook_bindings: scanner_kind extension + config column
-- ---------------------------------------------------------------------------
ALTER TABLE public.claude_hook_bindings
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.claude_hook_bindings
  DROP CONSTRAINT IF EXISTS claude_hook_bindings_scanner_kind_check;
ALTER TABLE public.claude_hook_bindings
  ADD CONSTRAINT claude_hook_bindings_scanner_kind_check
  CHECK (scanner_kind IN ('regex','heuristic','relay','snapshot'));

COMMENT ON COLUMN public.claude_hook_bindings.config IS
  'Structured per-binding configuration for non-regex kinds (relay: events/phase_map/tool_derivation; snapshot: rate limits). Injected verbatim into generated hook scripts.';

-- ---------------------------------------------------------------------------
-- RPC: fn_upsert_agent_live_session
-- (body identical to SoT aisha/db/sql/functions/fn_upsert_agent_live_session.sql)
-- ---------------------------------------------------------------------------
\ir sql/functions/fn_upsert_agent_live_session.sql

-- ---------------------------------------------------------------------------
-- RPC: fn_log_agent_session_event
-- (body identical to SoT aisha/db/sql/functions/fn_log_agent_session_event.sql)
-- ---------------------------------------------------------------------------
\ir sql/functions/fn_log_agent_session_event.sql

-- Signature convergence for the agent-activity + AI spend/resolver governance
-- read-RPC surface: their RETURNS TABLE row types changed after first delivery
-- (e.g. list_active_agent_sessions cost_usd→cost in the universalize pass), and
-- CREATE OR REPLACE cannot change an existing function's OUT row type (42P13) —
-- an upgrading DB aborts heals right here (first hit 2026-07-14, idc-studio).
-- Same generic convergence as the Bricks 4/5/6 block further down: drop EVERY
-- overload of each name, then the \ir's below re-deliver the canonical SoT body
-- (each file carries its own REVOKE/GRANT, so grants survive the drop). No view
-- or trigger depends on any of these names; fresh DBs drop nothing (no-op).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN (
         'list_active_agent_sessions', 'list_active_agent_runs',
         'fn_authorize_task_spend', 'approve_task_spend_audited',
         'list_pending_spend_approvals', 'set_ai_spend_policy_audited',
         'list_ai_spend_policies', 'fn_get_decision_outcomes',
         'set_ai_resolver_policy_audited', 'list_ai_resolver_policies',
         'get_ai_decisions_admin')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- RPC: list_active_agent_sessions
-- (body identical to SoT aisha/db/sql/functions/list_active_agent_sessions.sql)
-- ---------------------------------------------------------------------------
\ir sql/functions/list_active_agent_sessions.sql

-- ---------------------------------------------------------------------------
-- RPC: get_agent_phase_catalog
-- (body identical to SoT aisha/db/sql/functions/get_agent_phase_catalog.sql)
-- ---------------------------------------------------------------------------
\ir sql/functions/get_agent_phase_catalog.sql

-- ---------------------------------------------------------------------------
-- list_active_agent_runs: exclude ide_session aggregates (they surface in the
-- AgentSessionsStrip pane via list_active_agent_sessions). Full replacement —
-- body identical to SoT aisha/db/sql/functions/list_active_agent_runs.sql.
-- ---------------------------------------------------------------------------
\ir sql/functions/list_active_agent_runs.sql

-- ---------------------------------------------------------------------------
-- mcp_get_claude_hook_bindings: expose config in output
-- (body identical to SoT aisha/db/sql/functions/mcp_get_claude_hook_bindings.sql)
-- ---------------------------------------------------------------------------
\ir sql/functions/mcp_get_claude_hook_bindings.sql

-- ---------------------------------------------------------------------------
-- Seeds: phase catalog + supervisor-relay binding (idempotent ON CONFLICT)
-- ---------------------------------------------------------------------------
INSERT INTO public.agent_phase_catalog (axis, slug, labels, sort_order)
VALUES
  ('activity', 'idle',      jsonb_build_object('cs', 'nečinný',    'en', 'idle'),      0),
  ('activity', 'planning',  jsonb_build_object('cs', 'plánuje',    'en', 'planning'),  1),
  ('activity', 'tool_use',  jsonb_build_object('cs', 'pracuje',    'en', 'tool use'),  2),
  ('activity', 'reviewing', jsonb_build_object('cs', 'kontroluje', 'en', 'reviewing'), 3),
  ('activity', 'stopped',   jsonb_build_object('cs', 'ukončeno',   'en', 'stopped'),   4),
  ('pipeline', 'routing',   jsonb_build_object('cs', 'směrování',  'en', 'routing'),   0),
  ('pipeline', 'edge',      jsonb_build_object('cs', 'edge',       'en', 'edge'),      1),
  ('pipeline', 'backend',   jsonb_build_object('cs', 'backend',    'en', 'backend'),   2),
  ('pipeline', 'eval',      jsonb_build_object('cs', 'evaluace',   'en', 'eval'),      3),
  ('pipeline', 'streaming', jsonb_build_object('cs', 'streamuje',  'en', 'streaming'), 4)
ON CONFLICT (axis, slug) DO UPDATE SET
  labels = EXCLUDED.labels,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

INSERT INTO public.claude_hook_bindings
  (rule_slug, hook_event, matcher, scanner_kind, pattern_regex,
   messages, hint, cooldown_sec, severity, config)
VALUES
  (
    'supervisor-relay',
    'SessionStart',
    '*',
    'relay',
    NULL,
    jsonb_build_object(
      'cs', 'Supervisor relay: odesílá hook události (session_start/pre_tool/post_tool/stop) na /dirigent/dispatch pro živý monitoring a advisory nudges.',
      'en', 'Supervisor relay: forwards hook events (session_start/pre_tool/post_tool/stop) to /dirigent/dispatch for live monitoring and advisory nudges.'
    ),
    NULL,
    0,
    'low',
    $json$
    {
      "source": "claude-code",
      "endpoint_path": "/dirigent/dispatch",
      "timeout_ms": 5000,
      "events": [
        { "arg": "session_start", "hook_event": "SessionStart" },
        { "arg": "pre_tool", "hook_event": "PreToolUse", "matcher": "Edit|Write|MultiEdit|Agent" },
        { "arg": "post_tool", "hook_event": "PostToolUse", "matcher": "Edit|Write|MultiEdit|Bash|Agent" },
        { "arg": "stop", "hook_event": "Stop" }
      ],
      "phase_map": {
        "session_start": "session_start",
        "stop": "stopped",
        "pre_tool": { "Agent": "planning", "default": "tool_use" },
        "post_tool": { "default": "reviewing" },
        "default": "idle"
      },
      "tool_derivation": [
        { "tool": "Agent", "all_of": ["description", "prompt"] },
        { "tool": "MultiEdit", "all_of": ["edits"] },
        { "tool": "Bash", "all_of": ["command"] },
        { "tool": "Edit", "all_of": ["file_path", "new_string"] },
        { "tool": "Write", "all_of": ["file_path", "content"] }
      ]
    }
    $json$::jsonb
  )
ON CONFLICT (rule_slug) DO UPDATE SET
  hook_event = EXCLUDED.hook_event,
  matcher = EXCLUDED.matcher,
  scanner_kind = EXCLUDED.scanner_kind,
  pattern_regex = EXCLUDED.pattern_regex,
  messages = EXCLUDED.messages,
  hint = EXCLUDED.hint,
  cooldown_sec = EXCLUDED.cooldown_sec,
  severity = EXCLUDED.severity,
  config = EXCLUDED.config,
  is_active = true,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
INSERT INTO public.audit_journal (user_id, action_type, action, entity_type, area, metadata)
VALUES (
  NULL,
  'create',
  'agent_activity_monitoring.applied',
  'migration',
  'db',
  jsonb_build_object(
    'migration', '20260612202007_agent_activity_monitoring',
    'breaking_changes', false,
    'tables_added', ARRAY['agent_live_sessions', 'agent_phase_catalog'],
    'tables_altered', ARRAY['claude_hook_bindings'],
    'rpcs_added', ARRAY[
      'fn_upsert_agent_live_session',
      'fn_log_agent_session_event',
      'list_active_agent_sessions',
      'get_agent_phase_catalog'
    ],
    'rpcs_replaced', ARRAY['list_active_agent_runs', 'mcp_get_claude_hook_bindings']
  )
);

-- ─── the absorbed migration (now in the baseline) ──────────────
-- ============================================================================
-- ai_spend_governance — pre-flight cost estimation + user-driven allow/ask/deny
-- ============================================================================
-- "Vidět, co to může stát, a podle toho pouštět." Adds the cost-governance
-- lens over existing budget primitives:
--
--   ai_cost_class_catalog — seed-extensible kind→cost-band map (cold-start
--                           estimates + zero-config decision thresholds)
--   ai_spend_policies     — user-set allow/ask/deny USD thresholds per
--                           scope×kind (most specific active row wins)
--   fn_estimate_task_cost — 30d ai_runs percentiles, catalog fallback
--   fn_authorize_task_spend — estimate × policy × ai_budget (ALL periods)
--                           → allow | ask | deny
--   approve/reject_task_spend_audited — Mission Control decisions on
--                           admission-blocked runs (+optional budget raise)
--   list_pending_spend_approvals / set_ai_spend_policy_audited /
--   list_ai_spend_policies — pane + policy editor RPCs
--
-- Replaced (full bodies, identical to SoT):
--   fn_create_workflow_run   — binary lifetime check → authorize (ask/deny
--                              create blocked runs with awaiting metadata)
--   create_ai_run            — loud refusal on ask/deny (immediate-running path)
--   enqueue_agent_run        — loud refusal on ask/deny (execution plane)
--   fn_evaluate_proposal_risk — +task_spend category (WF_APPROVAL_GATE)
--
-- Also fixes a pre-existing hole in services (same PR): reflection
-- runWorkflow executed admission-blocked runs.
--
-- Source of truth pairs: aisha/db/sql/tables/{ai_cost_class_catalog,
-- ai_spend_policies}.sql + aisha/db/sql/functions/<all names above>.sql +
-- aisha/db/seed/core/29_ai_cost_class_catalog.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table: ai_cost_class_catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_cost_class_catalog (
  kind        text        PRIMARY KEY,
  -- Coarse class for UI badges + reasoning: micro|small|medium|large|xl
  cost_class  text        NOT NULL DEFAULT 'small',
  -- Expected cost band (USD): p50 = typical, p90 = conservative estimate.
  usd_p50     numeric(10,4) NOT NULL DEFAULT 0,
  usd_p90     numeric(10,4) NOT NULL DEFAULT 0,
  -- Expected token band (subscription-domain runs are budgeted in tokens).
  tokens_p90  int,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_cost_class_catalog_class_check
    CHECK (cost_class IN ('micro', 'small', 'medium', 'large', 'xl')),
  CONSTRAINT ai_cost_class_catalog_band_order
    CHECK (usd_p50 >= 0 AND usd_p90 >= usd_p50)
);

COMMENT ON TABLE public.ai_cost_class_catalog IS
  'Seed-extensible kind→cost-class bands. Cold-start estimates + default spend thresholds; real history (ai_runs percentiles) takes precedence in fn_estimate_task_cost.';

ALTER TABLE public.ai_cost_class_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_cost_class_catalog auth read" ON public.ai_cost_class_catalog;
CREATE POLICY "ai_cost_class_catalog auth read" ON public.ai_cost_class_catalog
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "ai_cost_class_catalog service full" ON public.ai_cost_class_catalog;
CREATE POLICY "ai_cost_class_catalog service full" ON public.ai_cost_class_catalog
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS ai_cost_class_catalog_updated_at ON public.ai_cost_class_catalog;
CREATE TRIGGER ai_cost_class_catalog_updated_at
  BEFORE UPDATE ON public.ai_cost_class_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Table: ai_spend_policies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_spend_policies (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'global' (scope_id NULL) | 'story' | 'partner'
  scope_type           text        NOT NULL DEFAULT 'global',
  scope_id             uuid,
  -- NULL = applies to all kinds within the scope ('*' wildcard row)
  task_kind            text,
  auto_allow_under numeric(10,4),
  ask_over         numeric(10,4),
  deny_over        numeric(10,4),
  is_active            boolean     NOT NULL DEFAULT true,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_spend_policies_scope_check
    CHECK (scope_type IN ('global', 'story', 'partner')),
  CONSTRAINT ai_spend_policies_scope_id_presence
    CHECK ((scope_type = 'global') = (scope_id IS NULL)),
  CONSTRAINT ai_spend_policies_threshold_order
    CHECK (
      (auto_allow_under IS NULL OR ask_over IS NULL
        OR auto_allow_under <= ask_over)
      AND (ask_over IS NULL OR deny_over IS NULL
        OR ask_over <= deny_over)
    ),
  CONSTRAINT ai_spend_policies_scope_kind_uniq
    UNIQUE NULLS NOT DISTINCT (scope_type, scope_id, task_kind)
);

COMMENT ON TABLE public.ai_spend_policies IS
  'User-set allow/ask/deny USD thresholds per scope×task-kind. Most specific active row wins; catalog bands are the zero-config fallback.';

CREATE INDEX IF NOT EXISTS idx_ai_spend_policies_lookup
  ON public.ai_spend_policies (scope_type, scope_id, task_kind)
  WHERE is_active = true;

ALTER TABLE public.ai_spend_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_spend_policies admin read" ON public.ai_spend_policies;
CREATE POLICY "ai_spend_policies admin read" ON public.ai_spend_policies
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_staff(auth.uid()));

DROP POLICY IF EXISTS "ai_spend_policies service full" ON public.ai_spend_policies;
CREATE POLICY "ai_spend_policies service full" ON public.ai_spend_policies
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS ai_spend_policies_updated_at ON public.ai_spend_policies;
CREATE TRIGGER ai_spend_policies_updated_at
  BEFORE UPDATE ON public.ai_spend_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RPC: fn_estimate_task_cost
-- ---------------------------------------------------------------------------
\ir sql/functions/fn_estimate_task_cost.sql

-- ---------------------------------------------------------------------------
-- RPC: fn_authorize_task_spend
-- ---------------------------------------------------------------------------
\ir sql/functions/fn_authorize_task_spend.sql

-- ---------------------------------------------------------------------------
-- RPC: approve_task_spend_audited
-- ---------------------------------------------------------------------------
\ir sql/functions/approve_task_spend_audited.sql

-- ---------------------------------------------------------------------------
-- RPC: reject_task_spend_audited
-- ---------------------------------------------------------------------------
\ir sql/functions/reject_task_spend_audited.sql

-- ---------------------------------------------------------------------------
-- RPC: list_pending_spend_approvals
-- ---------------------------------------------------------------------------
\ir sql/functions/list_pending_spend_approvals.sql

-- ---------------------------------------------------------------------------
-- RPC: set_ai_spend_policy_audited
-- ---------------------------------------------------------------------------
\ir sql/functions/set_ai_spend_policy_audited.sql

-- ---------------------------------------------------------------------------
-- RPC: list_ai_spend_policies
-- ---------------------------------------------------------------------------
\ir sql/functions/list_ai_spend_policies.sql

-- ---------------------------------------------------------------------------
-- REPLACE: fn_create_workflow_run (spend admission)
-- ---------------------------------------------------------------------------
\ir sql/functions/fn_create_workflow_run.sql

-- ---------------------------------------------------------------------------
-- REPLACE: create_ai_run (spend admission)
-- ---------------------------------------------------------------------------
\ir sql/functions/create_ai_run.sql

-- ---------------------------------------------------------------------------
-- REPLACE: enqueue_agent_run (spend admission)
-- ---------------------------------------------------------------------------
\ir sql/functions/enqueue_agent_run.sql

-- ---------------------------------------------------------------------------
-- REPLACE: fn_evaluate_proposal_risk (+task_spend)
-- ---------------------------------------------------------------------------
\ir sql/functions/fn_evaluate_proposal_risk.sql

-- ---------------------------------------------------------------------------
-- Seed: ai_cost_class_catalog
-- ---------------------------------------------------------------------------
INSERT INTO public.ai_cost_class_catalog
  (kind, cost_class, usd_p50, usd_p90, tokens_p90, description)
VALUES
  -- ai_runs.kind
  ('chat',             'micro',  0.02,  0.10,    50000, 'Interactive chat turn'),
  ('reflection',       'small',  0.15,  0.60,   200000, 'Reflection workflow run'),
  ('proactive',        'micro',  0.01,  0.05,    20000, 'Proactive trigger evaluation'),
  ('compliance_check', 'small',  0.10,  0.50,   150000, 'Compliance scan of a change set'),
  ('guild_review',     'medium', 0.50,  2.00,   500000, 'Multi-agent guild review'),
  ('pr_gate',          'small',  0.20,  0.80,   250000, 'PR gate evaluation'),
  ('incident',         'medium', 0.50,  3.00,   600000, 'Incident analysis + response'),
  ('doc_update',       'small',  0.10,  0.60,   200000, 'Documentation update run'),
  ('project_delivery', 'xl',     5.00, 20.00,  4000000, 'Full project delivery orchestration'),
  ('ide_session',      'large',  1.00,  8.00,  2000000, 'Interactive IDE/CLI work session (subscription runs budget in tokens)'),
  -- ai_tasks.task_type
  ('batch_analysis',   'medium', 0.50,  2.00,   800000, 'Batch document/data analysis'),
  ('data_export',      'micro',  0.02,  0.10,    30000, 'Structured data export'),
  ('evaluation_run',   'medium', 0.40,  1.50,   500000, 'Eval pipeline run over golden set'),
  ('knowledge_sync',   'small',  0.10,  0.50,   200000, 'Knowledge base sync/embedding'),
  ('report_generation','small',  0.20,  1.00,   300000, 'Report generation'),
  -- agent_runs.kind (isolated workloads)
  ('plugin-exec',      'small',  0.10,  0.50,   150000, 'Sandboxed plugin execution'),
  ('workflow-exec',    'medium', 0.30,  1.50,   400000, 'Sandboxed workflow execution'),
  ('repo-agent',       'large',  1.00,  6.00,  1500000, 'Repository agent (code changes)'),
  ('doc-agent',        'small',  0.20,  1.00,   300000, 'Documentation agent')
ON CONFLICT (kind) DO UPDATE SET
  cost_class  = EXCLUDED.cost_class,
  usd_p50     = EXCLUDED.usd_p50,
  usd_p90     = EXCLUDED.usd_p90,
  tokens_p90  = EXCLUDED.tokens_p90,
  description = EXCLUDED.description,
  is_active   = true,
  updated_at  = now();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
INSERT INTO public.audit_journal (user_id, action, metadata)
VALUES (
  NULL,
  'ai_spend_governance.applied',
  jsonb_build_object(
    'migration', '20260612213842_ai_spend_governance',
    'breaking_changes', false,
    'tables_added', ARRAY['ai_cost_class_catalog', 'ai_spend_policies'],
    'rpcs_added', ARRAY[
      'fn_estimate_task_cost', 'fn_authorize_task_spend',
      'approve_task_spend_audited', 'reject_task_spend_audited',
      'list_pending_spend_approvals', 'set_ai_spend_policy_audited',
      'list_ai_spend_policies'
    ],
    'rpcs_replaced', ARRAY[
      'fn_create_workflow_run', 'create_ai_run',
      'enqueue_agent_run', 'fn_evaluate_proposal_risk'
    ]
  )
);

-- ─── agent_runs.inputs (fe939cf1 baseline-fold; no standalone delta) ────────
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS inputs jsonb;

-- ─── agent_runs.outputs + update_agent_run_status (CLI result-format contract) ─
-- The executor's STRUCTURED result (validated `__result` sentinel + log tail) was
-- parsed then discarded — only exit_code was persisted. Add the column and re-apply
-- update_agent_run_status, which now DROPs its old 7-arg signature and CREATEs an
-- 8-arg form with p_outputs jsonb. Idempotent: ADD COLUMN IF NOT EXISTS + the fn's
-- own DROP-then-CREATE reach existing DBs (the baseline only re-applies on --wipe).
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS outputs jsonb;
\ir sql/functions/update_agent_run_status.sql

-- ─── agent_runs admission/approval (E0 — fn_admit_clow 'ask' → held for approval) ─
-- The CLI dispatch is now admission-gated: an 'ask' verdict holds the run pending
-- human approval, 'deny' refuses, 'allow' proceeds — and every dispatch mints an
-- ai_decisions row (I1). Reconcile existing DBs: the approval columns + the new/
-- changed claim/spawn/approve/inbox functions (the baseline only applies on --wipe).
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS approval_required boolean DEFAULT false NOT NULL;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS awaiting text;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS decision_id uuid;
-- requested_by: a system-spawned claude_cli_task (fn_spawn under service_role,
-- auth.uid()=NULL) has no human requester — drop the NOT NULL so the spawn doesn't
-- trip the constraint (mirrors playwright_runs.requested_by). Idempotent.
ALTER TABLE public.agent_runs ALTER COLUMN requested_by DROP NOT NULL;
-- The admission composer itself: reconcile so existing DBs get the autonomy axis
-- (a runtime's DECLARED autonomy_class='supervised' now forces 'ask' — human review —
-- instead of being descriptive-only). Idempotent CREATE OR REPLACE; late-bound, so
-- its position relative to the axis helpers it calls does not matter.
\ir sql/functions/fn_admit_clow.sql
\ir sql/functions/claim_queued_claude_run.sql
\ir sql/functions/fn_spawn_claude_cli_run.sql
\ir sql/functions/approve_claude_run.sql
\ir sql/functions/list_pending_claude_approvals.sql
\ir sql/functions/get_agent_run.sql


-- ============================================================================
-- #422 PRE-REQUEST JIT-PROVISIONING — reconcile onto existing DBs
-- ============================================================================
-- The 409 twin of claude_hook_bindings.config. #422 wired the documented
-- first-request hook — public.ensure_current_user, fired globally via
-- public.aisha_pre_request as PostgREST's db-pre-request — by FOLDING the two
-- functions + the role wiring into the baseline. So they reach FRESH DBs but
-- NEVER existing ones (the baseline is not re-applied). On an existing prod DB
-- the function is ABSENT and the role setting UNSET, so an authenticated caller
-- with a valid JWT but no aisha_auth.users row is never provisioned, and every
-- write to a table whose user_id FKs aisha_auth.users fails with FK 23503 →
-- PostgREST 409 (get_my_consents, get_my_chat_conversations, grant_consent, …).
-- The baseline comment even claims this "resolves on existing-DB re-migrate" — it
-- does not, because the baseline is the only place it lives. Reconcile it here,
-- the path that actually runs on every migrate. All idempotent (CREATE OR REPLACE
-- / GRANT / ALTER ROLE SET); verbatim the SoT in aisha/db/sql/functions/.
-- ----------------------------------------------------------------------------

\ir sql/functions/ensure_current_user.sql

\ir sql/functions/aisha_pre_request.sql

-- fn_user_can_read_run: on-behalf-of authz for GET /reflect/runs/:id (Omni reflection
-- poll). New additive SECURITY DEFINER fn that must reach EXISTING DBs (the baseline is
-- never re-applied), so it rides heals via \ir — a single SoT copy, no duplicate.
-- Idempotent CREATE OR REPLACE; depends only on is_admin_or_staff + is_story_participant
-- (both in the baseline, applied before heals). The trailing NOTIFY pgrst reload picks it up.
\ir sql/functions/fn_user_can_read_run.sql

-- aisha_resolve_clow_backend: the re-apply that used to live here moved to the
-- "heal PR1: ai_resolver_policy" block below. The SoT body is now policy-driven —
-- it references ai_resolver_policy%ROWTYPE at CREATE time — so on an existing DB
-- that predates the table, an early \ir here aborts the whole heals run before
-- the table heal is ever reached. The later block \ir's the same SoT file AFTER
-- creating + seeding the table, which also covers this block's original intent
-- (delivering the max_output_tokens/context_window/pricing body to existing DBs).

-- Wire the hook as PostgREST's global db-pre-request via in-DB config (the core
-- compose is at the Coolify ARG_MAX ceiling and cannot carry PGRST_DB_PRE_REQUEST
-- as an env). Drift-proof: the ALTER ROLE lives in the SoT
-- (aisha/db/sql/grants/authenticator_pgrst_pre_request.sql) and is re-applied here
-- via \ir — a SINGLE SoT copy, not a hand-maintained heals duplicate that could
-- drift from the baseline. Idempotent role-GUC. The authenticator role is created
-- by infra/pg17/000_init_roles_schemas.sql, present on every existing DB.
\ir sql/grants/authenticator_pgrst_pre_request.sql

-- Re-apply the get_story_entries_audited SoT (CREATE OR REPLACE, idempotent): fixes a stale
-- public.partners reference left from the partner→partner_profiles rebrand, surfaced by the real-DB
-- flowboard integration run (its resume path is the function's first real caller; existing DBs that
-- never called it kept the broken body). \ir = single SoT copy, no heals duplicate that could drift.
\ir sql/functions/get_story_entries_audited.sql

-- ============================================================================
-- §11 DATA-SENSITIVITY REGISTRY (Fix D) — reconcile onto existing DBs
-- ============================================================================
-- The on-prem residency anchor list moved from a hardcoded svc literal to a DB
-- registry the svc reads (TTL cache; fail-safe to its built-in baseline). The
-- enum + table + RLS + read RPC + audit writer are folded into the baseline for
-- fresh DBs, but the baseline is never re-applied, so reconcile them here for
-- existing DBs. All idempotent; NO-OP on fresh DBs. Order matters: enum → table
-- → RLS/grants → functions (the LANGUAGE sql reader references the table, so the
-- table must exist before the function body is validated at CREATE).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_sensitivity') THEN
    CREATE TYPE public.data_sensitivity AS ENUM ('public', 'internal', 'confidential');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.data_sensitivity_registry (
  table_name  text PRIMARY KEY,
  sensitivity public.data_sensitivity NOT NULL DEFAULT 'confidential',
  category    text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_sensitivity_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_sensitivity_registry read" ON public.data_sensitivity_registry;
CREATE POLICY "data_sensitivity_registry read" ON public.data_sensitivity_registry
  AS PERMISSIVE FOR SELECT TO public USING (is_admin_or_staff(auth.uid()) OR auth.role() = 'service_role');
DROP POLICY IF EXISTS "data_sensitivity_registry admin" ON public.data_sensitivity_registry;
CREATE POLICY "data_sensitivity_registry admin" ON public.data_sensitivity_registry
  AS PERMISSIVE FOR ALL TO public
  USING (is_admin_or_staff(auth.uid())) WITH CHECK (is_admin_or_staff(auth.uid()));

GRANT SELECT ON public.data_sensitivity_registry TO authenticated;
GRANT ALL ON public.data_sensitivity_registry TO service_role;

DROP TRIGGER IF EXISTS data_sensitivity_registry_updated_at ON public.data_sensitivity_registry;
CREATE TRIGGER data_sensitivity_registry_updated_at
  BEFORE UPDATE ON public.data_sensitivity_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

\ir sql/functions/get_data_sensitivity_registry.sql
\ir sql/functions/record_residency_audit.sql

-- (The Bricks 3–6 RAG-axis reconcile — locale columns, widened per-locale
-- arbiters, guild_db mirror trigger and the whole search/ingest RPC surface —
-- lives in the bricks area near heal #33 below: the tier helpers are
-- LANGUAGE sql (validated at CREATE) and depend on audience views/columns
-- that the generational reconcile further down must establish first.)

-- RAG Brick 0b: the v2 (Qwen3 halfvec(2560)) embedding write path, consolidated to a
-- SINGLE text-input audited writer (mirrors v1 insert_knowledge_embedding(text)). The
-- prior vector/halfvec typed overloads were a PGRST203-ambiguous back-port artifact with
-- zero callers — DROP them so an upgrading DB converges on the one canonical text signature
-- (CREATE OR REPLACE alone can't remove the now-deleted overloads). knowledge_embeddings +
-- the halfvec extension are established earlier in heals; the function body's column refs
-- are deferred (validated at call time, not at CREATE), so this \ir is order-safe.
DROP FUNCTION IF EXISTS public.insert_knowledge_embedding_v2_audited(uuid, vector, text, text);
DROP FUNCTION IF EXISTS public.insert_knowledge_embedding_v2_audited(uuid, halfvec, text, text);
\ir sql/functions/insert_knowledge_embedding_v2_audited.sql

-- Same multi-typed-overload anti-pattern, second member of the class: the multimodal-page
-- v2 writer carried vector/halfvec overloads (PGRST203-ambiguous, 0 callers). Consolidated
-- to one text-input audited writer; DROP the old typed overloads so an upgrading DB converges
-- (CREATE OR REPLACE can't remove a vanished overload). Body column refs are deferred.
DROP FUNCTION IF EXISTS public.fn_record_multimodal_page_audited(uuid, integer, text, text, text, vector, text, text, jsonb);
DROP FUNCTION IF EXISTS public.fn_record_multimodal_page_audited(uuid, integer, text, text, text, halfvec, text, text, jsonb);
\ir sql/functions/fn_record_multimodal_page_audited.sql

-- (The Brick2-guard — knowledge_embeddings model-identity FK columns + backfill —
-- moved BELOW the ai_model_registry establishment block. Its former comment claimed
-- "ai_model_registry is established earlier in heals", but the registry block sits
-- LATER in this file: on a pre-Brick2 DB the FK ADD CONSTRAINT and the backfill
-- UPDATEs executed here against a table that does not exist yet, aborting the whole
-- heals run before the registry heal was ever reached.)

-- RAG brick 1c: resolve a NAMED embedding model's backend + corpus space, so the eval/
-- sweep can honestly embed the query with the candidate model (not a hardcoded v1 label).
-- New function — idempotent CREATE OR REPLACE; ai_model_registry + ai_provider_registry
-- are established earlier in heals.
\ir sql/functions/fn_resolve_embedding_model.sql
-- Brick2-PIN: resolve the live embedding model FOR a corpus space ('v1'/'v2') so the prod
-- search path embeds the query in the SAME space the context's embedding_model_pref names.
-- New function — idempotent CREATE OR REPLACE; ai_model_registry + ai_provider_registry
-- are established earlier in heals.
\ir sql/functions/fn_resolve_embedding_model_for_space.sql
-- (mcp_search_knowledge_v3's re-apply moved into the "Bricks 3–6 RAG axis" block
-- above — its Brick5/6 signature growth needs the drop-all-overloads convergence
-- plus the locale columns and tier helpers established there first.)
-- RAG brick 1e: head-to-head embedding-model comparison (winner per context_profile×language
-- by nDCG@K). New function — idempotent; rag_eval_runs established earlier in heals.
\ir sql/functions/fn_compare_rag_embedding_models.sql

-- Fail-safe seed of the baseline confidential anchors (idempotent) so existing DBs
-- get the DB-driven path immediately on migrate. The svc also fails safe to this
-- same list, so an un-seeded DB is never LESS strict than before.
INSERT INTO public.data_sensitivity_registry (table_name, sensitivity, category, note) VALUES
  ('member_health_documents', 'confidential', 'phi', 'Member health documents (PHI) — on-prem only'),
  ('dosing_logs',             'confidential', 'phi', 'Supplement/medication dosing logs (PHI) — on-prem only'),
  ('longevity_scores',        'confidential', 'phi', 'Derived longevity scores (PHI) — on-prem only')
ON CONFLICT (table_name) DO NOTHING;

-- Make a *running* PostgREST re-read its role config (db_pre_request) + schema
-- cache (the just-included functions) NOW, so the hook activates without waiting
-- for a container restart. No-op when nothing is LISTENing on the channel.
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- GENERATIONAL FEATURE TABLES (May–Jun 2026) — reconcile onto existing DBs
-- ============================================================================
-- A run of "generational" feature PRs (plugin control plane, AITG test-gen,
-- voice/call rooms, RAG-eval, graph nodes/edges, workflow statuses, intranet
-- chat, LLM quota, web-artifact jobs, …) added 61 tables to the SoT + baseline
-- + seed, but NONE of them to this file. The baseline reaches FRESH DBs only;
-- on an EXISTING prod DB the tables stay absent, so the redeploy's `npm run
-- db:seed` aborts at the first INSERT into one of them — observed:
--   ERROR: relation "public.ai_runtime_registry" does not exist
--   [migrate] === DONE status=seed_failed exit=1 ===   → aisha-core deploy fails.
-- This block is the existing-DB reconcile the baseline-only model lacks. Every
-- statement is idempotent and a NO-OP on a fresh DB (the baseline already built
-- the object). Ordering mirrors the baseline generator:
--   enums (guarded DO) → tables (FK-topo, CREATE TABLE IF NOT EXISTS + inline
--   ENABLE RLS) → indexes (CREATE INDEX IF NOT EXISTS) → RLS (ENABLE … is
--   idempotent) → policies (DROP POLICY IF EXISTS injected, like the generator)
--   → grants (idempotent) → triggers (DROP TRIGGER IF EXISTS injected).
-- Tables are emitted in the baseline's FK-topological order, so a table with an
-- in-set FK (e.g. intranet_chat_messages→channels, plugin_*→plugin_catalog,
-- graph_edges→graph_nodes, call_*→voice_rooms, aitg_*→aitg_test_catalog,
-- rag_eval_runs→rag_eval_golden, llm_quota→llm_tier_defaults,
-- workflow_status_transitions→workflow_statuses) always follows its target.
-- The SoT files are \ir-included (single source of truth, no drift); the only
-- objects bare-by-convention in SoT (standalone policy files + updated_at
-- trigger files, which the generator guards at emit-time) get an explicit
-- DROP … IF EXISTS injected here so heals stays runnable twice with no error.
-- ============================================================================

-- ── enums first (each SoT file is a guarded `DO $$ … IF NOT EXISTS pg_type`) ──
\ir sql/enums/plugin_kind.sql
\ir sql/enums/plugin_trust_tier.sql
\ir sql/enums/plugin_status.sql
\ir sql/enums/plugin_health_event_kind.sql
\ir sql/enums/playwright_run_status.sql
\ir sql/enums/playwright_run_trigger.sql
\ir sql/enums/web_artifact_kind.sql
\ir sql/enums/web_artifact_source_type.sql
\ir sql/enums/web_artifact_job_status.sql

-- ── tables (FK-topological order) — BACKFILL-AWARE reconcile ──────────────────
-- For each table: CREATE TABLE IF NOT EXISTS (full SoT body — builds a fully
-- MISSING table with all columns + PK/FK/CHECK constraints) → one ADD COLUMN IF
-- NOT EXISTS per SoT column (backfills any column missing on an EXISTING OLDER
-- table) → \ir the SoT file (its CREATE TABLE is now a no-op, ENABLE RLS is
-- idempotent, and its COMMENT ON COLUMN now finds every column).
--
-- WHY the bare \ir was insufficient: CREATE TABLE IF NOT EXISTS SKIPS an
-- existing (older) table entirely, so a column added to the SoT later is never
-- created; a later same-file statement that references it then aborts —
-- observed in prod: `COMMENT ON COLUMN public.plugin_catalog.agent_spec` →
-- ERROR: column "agent_spec" of relation "public.plugin_catalog" does not exist
-- → [migrate] npm run db:migrate exit=1. The ADD COLUMN IF NOT EXISTS pass below
-- runs BEFORE every column-referencing statement, so an existing older table
-- gets its missing columns first. NOT-NULL columns WITHOUT a default are added
-- NULLABLE (ADD COLUMN ... NOT NULL fails on a populated table; the table
-- already exists in prod with rows); columns WITH a default keep NOT NULL (the
-- default backfills existing rows). GENERATED columns keep their expression.
-- This whole block is generated mechanically from the SoT CREATE TABLE column
-- lists, stays idempotent, and is runnable twice with no error.

-- ai_decisions
CREATE TABLE IF NOT EXISTS public.ai_decisions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid,
  story_id      uuid,
  clow_purpose  text,
  runtime       text        NOT NULL DEFAULT 'direct_llm'
  CHECK (runtime IN ('direct_llm', 'openclaw', 'hermes', 'workflow', 'human', 'cli')),
  cli_slug      text,
  provider_slug text,
  model_id      text,
  backend_kind  text,
  strategy      text        CHECK (strategy IS NULL OR strategy IN ('sync', 'batch')),
  admission_verdict text    CHECK (admission_verdict IS NULL OR admission_verdict IN ('allow', 'ask', 'deny')),
  risk_level    text        CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical')),
  approval_required boolean NOT NULL DEFAULT false,
  resolution_source text    CHECK (resolution_source IS NULL OR resolution_source IN
  ('clow_backend', 'model_override', 'slot', 'admission_deny', 'policy', 'fallback')),
  reason        text,
  estimated_cost numeric(12,6),
  decision_json jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS clow_purpose text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS runtime text NOT NULL DEFAULT 'direct_llm';
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS cli_slug text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS provider_slug text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS backend_kind text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS strategy text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS admission_verdict text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS risk_level text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS resolution_source text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS estimated_cost numeric(12,6);
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS decision_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/ai_decisions.sql

-- ai_provider_registry
CREATE TABLE IF NOT EXISTS public.ai_provider_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  backend_kind text NOT NULL CHECK (backend_kind IN (
  'direct_cloud',
  'llm_gateway',
  'local_ollama',
  'local_vllm',
  'mcp_server'
  )),
  endpoint_url text,
  health_url text,
  auth_kind text NOT NULL DEFAULT 'bearer' CHECK (auth_kind IN ('bearer', 'api_key_header', 'none')),
  auth_env_var text,
  supports_chat boolean NOT NULL DEFAULT true,
  supports_tool_use boolean NOT NULL DEFAULT false,
  supports_vision boolean NOT NULL DEFAULT false,
  supports_batch boolean NOT NULL DEFAULT false,
  supports_streaming boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT true,
  last_health_status text NOT NULL DEFAULT 'unknown' CHECK (last_health_status IN ('healthy', 'degraded', 'down', 'unknown')),
  last_health_checked_at timestamptz,
  last_health_detail text,
  consecutive_failure_count int NOT NULL DEFAULT 0,
  cost_class text DEFAULT 'standard' CHECK (cost_class IN ('budget', 'standard', 'premium')),
  scoped_to_instance_id uuid,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS backend_kind text;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS endpoint_url text;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS health_url text;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS auth_kind text NOT NULL DEFAULT 'bearer';
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS auth_env_var text;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS supports_chat boolean NOT NULL DEFAULT true;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS supports_tool_use boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS supports_vision boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS supports_batch boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS supports_streaming boolean NOT NULL DEFAULT true;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS last_health_status text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS last_health_checked_at timestamptz;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS last_health_detail text;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS consecutive_failure_count int NOT NULL DEFAULT 0;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS cost_class text DEFAULT 'standard';
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS scoped_to_instance_id uuid;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/ai_provider_registry.sql

-- ai_model_registry — discovery/dispatch registry. Was ABSENT from heals, so an in-place
-- upgrade never backfilled later-added columns. provider_registry_id (added ~d62f406f) is
-- referenced by upsert_discovered_model + aisha_resolve_clow_backend + aisha_evaluate_
-- provider_for_task → those fail at RUNTIME on a DB created before the column. Mirror the
-- ai_provider_registry block: create-if-absent, per-column ADD COLUMN IF NOT EXISTS
-- backfill, then re-apply the SoT table + (DO-guarded) FK + (IF NOT EXISTS) index. The FK
-- target ai_provider_registry is created just above, so it is satisfiable here.
CREATE TABLE IF NOT EXISTS public.ai_model_registry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider text NOT NULL,
  model_id text NOT NULL,
  display_name text,
  model_family text,
  is_chat_capable boolean DEFAULT true NOT NULL,
  is_reasoning boolean DEFAULT false NOT NULL,
  is_vision boolean DEFAULT false NOT NULL,
  is_code_optimized boolean DEFAULT false NOT NULL,
  is_function_calling boolean DEFAULT false NOT NULL,
  context_window integer,
  max_output_tokens integer,
  input_price_per_m numeric,
  output_price_per_m numeric,
  cached_input_price_per_m numeric,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  is_available boolean DEFAULT true NOT NULL,
  is_admin_active boolean DEFAULT false NOT NULL,
  is_deprecated boolean DEFAULT false NOT NULL,
  deprecation_date timestamp with time zone,
  eval_status text DEFAULT 'pending'::text NOT NULL,
  latest_eval_run_id uuid,
  latest_eval_score numeric,
  latest_eval_at timestamp with time zone,
  provider_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  slot_affinity jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS model_family text;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_chat_capable boolean NOT NULL DEFAULT true;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_reasoning boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_vision boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_code_optimized boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_function_calling boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS context_window integer;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS max_output_tokens integer;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS input_price_per_m numeric;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS output_price_per_m numeric;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS cached_input_price_per_m numeric;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS first_seen_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS last_seen_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_admin_active boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_deprecated boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS deprecation_date timestamp with time zone;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS eval_status text NOT NULL DEFAULT 'pending'::text;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS latest_eval_run_id uuid;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS latest_eval_score numeric;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS latest_eval_at timestamp with time zone;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS slot_affinity jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS provider_registry_id uuid;
-- RAG brick 1a: embedding capability (derived flag + native dim) so an embedding model
-- is a first-class capability-available entity the resolver can return for task_kind='embedding'.
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS is_embedding boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_model_registry ADD COLUMN IF NOT EXISTS embedding_dimensions integer;
\ir sql/tables/ai_model_registry.sql
\ir sql/constraints/ai_model_registry_provider_registry_id_fkey.sql
\ir sql/indexes/idx_ai_model_registry_provider_registry_id.sql
-- The seed's ON CONFLICT (provider, model_id) arbiter — a healed registry WITHOUT it
-- kills db:seed on the very next step of every migrate (found by the upgrade gate's
-- pre-Brick2 regress). Both index SoT files are IF NOT EXISTS (idempotent).
\ir sql/indexes/ai_model_registry_provider_model_unique.sql
\ir sql/indexes/idx_ai_model_registry_slot_affinity.sql

-- ── Brick2-guard: model identity on knowledge_embeddings (existing-DB reconcile) ──────
-- Two nullable uuid FK columns linking the human-readable model/model_v2 text mirror to
-- the canonical ai_model_registry row that produced the vector. The writers (re-\ir'd
-- in the RAG section above) RAISE on an unregistered model and PIN these ids; the
-- columns must exist on an EXISTING prod DB before the first writer call. NULLABLE +
-- NO ON DELETE CASCADE (training_jobs.adapter_model_id pattern) — deprecating a model
-- must NEVER cascade-delete the corpus. This block MUST stay below the ai_model_registry
-- establishment just above: the ADD CONSTRAINT and the backfill UPDATEs execute
-- immediately (not deferred), so on a pre-Brick2 DB they abort if the registry table
-- does not exist yet.
ALTER TABLE public.knowledge_embeddings ADD COLUMN IF NOT EXISTS model_registry_id uuid;
ALTER TABLE public.knowledge_embeddings ADD COLUMN IF NOT EXISTS model_v2_registry_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_embeddings_model_registry_id_fkey') THEN
    ALTER TABLE public.knowledge_embeddings
      ADD CONSTRAINT knowledge_embeddings_model_registry_id_fkey
      FOREIGN KEY (model_registry_id) REFERENCES public.ai_model_registry(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_embeddings_model_v2_registry_id_fkey') THEN
    ALTER TABLE public.knowledge_embeddings
      ADD CONSTRAINT knowledge_embeddings_model_v2_registry_id_fkey
      FOREIGN KEY (model_v2_registry_id) REFERENCES public.ai_model_registry(id);
  END IF;
END $$;
\ir sql/indexes/idx_knowledge_embeddings_model_registry.sql
\ir sql/indexes/idx_knowledge_embeddings_model_v2_registry.sql
-- Idempotent, set-based deferred backfill: link legacy rows to their registry row by the
-- text model mirror. Runs only where the FK id is still NULL, so it converges once and is a
-- no-op on every subsequent migrate. Rows whose text model has no ai_model_registry match
-- stay NULL (the writers reject NEW unregistered models; legacy orphans are left for an
-- operator to reconcile, never force-deleted).
UPDATE public.knowledge_embeddings ke
   SET model_registry_id = r.id
  FROM public.ai_model_registry r
 WHERE r.model_id = ke.model
   AND r.is_embedding
   AND ke.model_registry_id IS NULL;
UPDATE public.knowledge_embeddings ke
   SET model_v2_registry_id = r.id
  FROM public.ai_model_registry r
 WHERE r.model_id = ke.model_v2
   AND r.is_embedding
   AND ke.model_v2 IS NOT NULL
   AND ke.model_v2_registry_id IS NULL;

-- ai_risk_policies
CREATE TABLE IF NOT EXISTS public.ai_risk_policies (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type            text        NOT NULL DEFAULT 'global',
  scope_id              uuid,
  task_kind             text,
  auto_allow_at_or_below text       CHECK (auto_allow_at_or_below IS NULL OR auto_allow_at_or_below IN ('low', 'medium', 'high', 'critical')),
  ask_above             text        CHECK (ask_above IS NULL OR ask_above IN ('low', 'medium', 'high', 'critical')),
  deny_above            text        CHECK (deny_above IS NULL OR deny_above IN ('low', 'medium', 'high', 'critical')),
  is_active             boolean     NOT NULL DEFAULT true,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_risk_policies_scope_check
  CHECK (scope_type IN ('global', 'story', 'partner')),
  CONSTRAINT ai_risk_policies_scope_id_presence
  CHECK ((scope_type = 'global') = (scope_id IS NULL)),
  CONSTRAINT ai_risk_policies_threshold_order
  CHECK (
  (auto_allow_at_or_below IS NULL OR ask_above IS NULL
  OR CASE auto_allow_at_or_below
  WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END
  <= CASE ask_above
  WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END)
  AND (ask_above IS NULL OR deny_above IS NULL
  OR CASE ask_above
  WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END
  <= CASE deny_above
  WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END)
  ),
  CONSTRAINT ai_risk_policies_scope_kind_uniq
  UNIQUE NULLS NOT DISTINCT (scope_type, scope_id, task_kind)
);
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'global';
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS scope_id uuid;
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS task_kind text;
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS auto_allow_at_or_below text;
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS ask_above text;
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS deny_above text;
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ai_risk_policies ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/ai_risk_policies.sql

-- ai_batch_jobs
CREATE TABLE IF NOT EXISTS public.ai_batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  external_batch_id text NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
  CHECK (status IN ('submitted', 'in_progress', 'completed', 'expired', 'failed', 'cancelled')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_polled_at timestamptz,
  request_count int NOT NULL DEFAULT 1,
  succeeded_count int NOT NULL DEFAULT 0,
  errored_count int NOT NULL DEFAULT 0,
  estimated_cost numeric(10,4),
  actual_cost numeric(10,4),
  result_url text,
  related_run_id uuid REFERENCES public.ai_runs(id),
  agent_slug text DEFAULT 'aisha',
  story_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_batch_jobs_provider_external_unique
  UNIQUE (provider, external_batch_id)
);
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS external_batch_id text;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'submitted';
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS last_polled_at timestamptz;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS request_count int NOT NULL DEFAULT 1;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS succeeded_count int NOT NULL DEFAULT 0;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS errored_count int NOT NULL DEFAULT 0;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS estimated_cost numeric(10,4);
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS actual_cost numeric(10,4);
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS result_url text;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS related_run_id uuid;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS agent_slug text DEFAULT 'aisha';
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ai_batch_jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/ai_batch_jobs.sql

-- ai_runtime_registry
CREATE TABLE IF NOT EXISTS public.ai_runtime_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_kind text NOT NULL CHECK (runtime_kind IN (
  'direct_llm',
  'openclaw',
  'hermes',
  'workflow',
  'human',
  'cli',
  'workbench'
  )),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  adapter_health text NOT NULL DEFAULT 'unknown' CHECK (adapter_health IN ('healthy', 'degraded', 'down', 'unknown')),
  adapter_health_checked_at timestamptz,
  consecutive_failure_count int NOT NULL DEFAULT 0,
  can_write boolean NOT NULL DEFAULT false,
  needs_network boolean NOT NULL DEFAULT false,
  supports_tools boolean NOT NULL DEFAULT false,
  side_effect_class text NOT NULL DEFAULT 'read_only' CHECK (side_effect_class IN (
  'read_only',
  'reversible',
  'irreversible'
  )),
  autonomy_class text NOT NULL DEFAULT 'supervised' CHECK (autonomy_class IN (
  'supervised',
  'semi',
  'autonomous'
  )),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS runtime_kind text;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS adapter_health text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS adapter_health_checked_at timestamptz;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS consecutive_failure_count int NOT NULL DEFAULT 0;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS can_write boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS needs_network boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS supports_tools boolean NOT NULL DEFAULT false;
-- Existing-DB backfill for the in-process-executor flag (else the column-explicit
-- 18_ai_runtime_catalog seed aborts with "column does not exist" on upgrade). Constant
-- DEFAULT = no table rewrite; the seed's ON CONFLICT re-derives the per-runtime value.
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS is_in_process_executor boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS side_effect_class text NOT NULL DEFAULT 'read_only';
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS autonomy_class text NOT NULL DEFAULT 'supervised';
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.ai_runtime_registry ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/ai_runtime_registry.sql

-- Enable cli:claude-cli as its RuntimeAdapter ships (fn_admit_clow's runtime axis
-- requires is_enabled, so the new fn_spawn would deny every CLI spawn on an
-- existing DB until this flips). The seed's ON CONFLICT intentionally never
-- touches is_enabled (operator opt-in survives re-seed), so this reconciles
-- existing rows. Guarded by is_in_process_executor=false so it fires ONCE — the
-- pre-adapter state — and after the flip a later operator is_enabled=false is
-- respected (is_in_process_executor stays true → the guard never matches again).
-- MUST sit AFTER the ai_runtime_registry column-backfill above: heals runs
-- top-to-bottom on an existing/regressed DB (the cold-start-upgrade-probe / prod
-- redeploy path), so is_enabled + is_in_process_executor have to be ADDed first.
UPDATE public.ai_runtime_registry
SET is_enabled = true, is_in_process_executor = true, updated_at = now()
WHERE slug = 'cli:claude-cli' AND is_in_process_executor = false;

-- aisha_static_defense_rules
CREATE TABLE IF NOT EXISTS public.aisha_static_defense_rules (
  rule_id          text PRIMARY KEY,
  category         text NOT NULL CHECK (category IN (
  'semgrep', 'eslint-no-secrets', 'owasp-exemption'
  )),
  owasp_category   text,
  semgrep_pattern  jsonb,
  semgrep_paths    jsonb,
  semgrep_message  text,
  languages        text[] DEFAULT ARRAY['typescript']::text[],
  severity         text NOT NULL CHECK (severity IN ('ERROR', 'WARNING', 'INFO')),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated')),
  version          integer NOT NULL DEFAULT 1,
  proposed_by      text,
  approved_by      uuid,
  rationale        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS rule_id text;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS owasp_category text;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS semgrep_pattern jsonb;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS semgrep_paths jsonb;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS semgrep_message text;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS languages text[] DEFAULT ARRAY['typescript']::text[];
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS proposed_by text;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS rationale text;
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.aisha_static_defense_rules ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/aisha_static_defense_rules.sql

-- aitg_aisha_reflections
CREATE TABLE IF NOT EXISTS public.aitg_aisha_reflections (
  reflection_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection_date         date NOT NULL,
  trust_score_snapshot    numeric NOT NULL CHECK (trust_score_snapshot BETWEEN 0 AND 100),
  trust_score_delta       numeric,
  total_runs_window       int NOT NULL DEFAULT 0,
  failed_runs_window      int NOT NULL DEFAULT 0,
  open_findings_count     int NOT NULL DEFAULT 0,
  new_failures_count      int NOT NULL DEFAULT 0,
  newly_fixed_count       int NOT NULL DEFAULT 0,
  drift_alerts_count      int NOT NULL DEFAULT 0,
  summary                 text NOT NULL CHECK (length(summary) >= 10),
  proposed_actions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by            text NOT NULL DEFAULT 'aisha',
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reflection_date, generated_by)
);
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS reflection_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS reflection_date date;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS trust_score_snapshot numeric;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS trust_score_delta numeric;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS total_runs_window int NOT NULL DEFAULT 0;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS failed_runs_window int NOT NULL DEFAULT 0;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS open_findings_count int NOT NULL DEFAULT 0;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS new_failures_count int NOT NULL DEFAULT 0;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS newly_fixed_count int NOT NULL DEFAULT 0;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS drift_alerts_count int NOT NULL DEFAULT 0;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS proposed_actions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS generated_by text NOT NULL DEFAULT 'aisha';
ALTER TABLE public.aitg_aisha_reflections ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/aitg_aisha_reflections.sql

-- aitg_automation_settings
CREATE TABLE IF NOT EXISTS public.aitg_automation_settings (
  automation_id        text PRIMARY KEY
  CHECK (automation_id ~ '^[a-z][a-z0-9_]+$'),
  display_name         text NOT NULL,
  description          text NOT NULL,
  mode                 text NOT NULL DEFAULT 'automated'
  CHECK (mode IN ('automated', 'manual', 'disabled')),
  schedule_cron        text,
  schedule_interval_minutes int CHECK (schedule_interval_minutes IS NULL
  OR schedule_interval_minutes BETWEEN 1 AND 1440),
  parameters           jsonb NOT NULL DEFAULT '{}'::jsonb,
  workflow_id          text,
  last_run_at          timestamptz,
  last_run_status      text CHECK (last_run_status IS NULL
  OR last_run_status IN ('success','failed','skipped','running')),
  last_run_details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES aisha_auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitg_automation_settings_schedule_exclusive CHECK (
  NOT (mode = 'automated' AND schedule_cron IS NOT NULL AND schedule_interval_minutes IS NOT NULL)
  )
);
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS automation_id text;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'automated';
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS schedule_cron text;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS schedule_interval_minutes int;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS parameters jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS workflow_id text;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS last_run_at timestamptz;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS last_run_status text;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS last_run_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.aitg_automation_settings ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/aitg_automation_settings.sql

-- aitg_test_catalog
CREATE TABLE IF NOT EXISTS public.aitg_test_catalog (
  test_id          text PRIMARY KEY CHECK (test_id ~ '^AITG-(APP|MOD|INF|DAT)-\d{2}$'),
  layer            aitg_layer NOT NULL,
  title            text NOT NULL,
  objective        text NOT NULL,
  remediation_ref  text NOT NULL,
  lifecycle_phases text[] NOT NULL DEFAULT '{}'::text[],
  severity_weight  numeric NOT NULL DEFAULT 1.0 CHECK (severity_weight >= 0),
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS test_id text;
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS layer aitg_layer;
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS remediation_ref text;
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS lifecycle_phases text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS severity_weight numeric NOT NULL DEFAULT 1.0;
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.aitg_test_catalog ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/aitg_test_catalog.sql

-- aitg_drift_alerts
CREATE TABLE IF NOT EXISTS public.aitg_drift_alerts (
  alert_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id          text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  window_label     text NOT NULL,
  current_pass_rate  numeric NOT NULL CHECK (current_pass_rate BETWEEN 0 AND 1),
  previous_pass_rate numeric NOT NULL CHECK (previous_pass_rate BETWEEN 0 AND 1),
  delta            numeric NOT NULL,
  severity         aitg_severity NOT NULL,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES aisha_auth.users(id),
  resolved_at      timestamptz,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS alert_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS test_id text;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS window_label text;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS current_pass_rate numeric;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS previous_pass_rate numeric;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS delta numeric;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS severity aitg_severity;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS acknowledged_by uuid;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.aitg_drift_alerts ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/aitg_drift_alerts.sql

-- aitg_payloads
CREATE TABLE IF NOT EXISTS public.aitg_payloads (
  payload_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id        text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  payload        jsonb NOT NULL,
  expected_block text NOT NULL,
  tags           text[] NOT NULL DEFAULT '{}'::text[],
  source         text NOT NULL DEFAULT 'internal',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS payload_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS test_id text;
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS expected_block text;
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal';
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.aitg_payloads ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/aitg_payloads.sql

-- aitg_payload_proposals
CREATE TABLE IF NOT EXISTS public.aitg_payload_proposals (
  proposal_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id        text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  payload        jsonb NOT NULL,
  expected_block text NOT NULL,
  tags           text[] NOT NULL DEFAULT '{}'::text[],
  justification  text NOT NULL CHECK (length(justification) >= 20),
  proposed_by    text NOT NULL DEFAULT 'aisha',
  status         text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by    uuid REFERENCES aisha_auth.users(id),
  reviewed_at    timestamptz,
  promoted_payload_id uuid REFERENCES public.aitg_payloads(payload_id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS proposal_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS test_id text;
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS expected_block text;
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS justification text;
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS proposed_by text NOT NULL DEFAULT 'aisha';
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS promoted_payload_id uuid;
ALTER TABLE public.aitg_payload_proposals ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/aitg_payload_proposals.sql

-- aitg_runs
CREATE TABLE IF NOT EXISTS public.aitg_runs (
  run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id       text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  build_sha     text NOT NULL,
  triggered_by  text NOT NULL CHECK (triggered_by IN ('pr-gate','nightly','manual','sentinel','self')),
  status        aitg_status NOT NULL,
  severity      aitg_severity NOT NULL DEFAULT 'info',
  evidence_uri  text,
  ai_run_id     uuid REFERENCES public.ai_runs(id),
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS run_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS test_id text;
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS build_sha text;
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS triggered_by text;
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS status aitg_status;
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS severity aitg_severity NOT NULL DEFAULT 'info';
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS evidence_uri text;
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS ai_run_id uuid;
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.aitg_runs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
\ir sql/tables/aitg_runs.sql

-- aitg_findings
CREATE TABLE IF NOT EXISTS public.aitg_findings (
  finding_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES public.aitg_runs(run_id) ON DELETE CASCADE,
  payload_id       uuid REFERENCES public.aitg_payloads(payload_id),
  severity         aitg_severity NOT NULL,
  observed         jsonb NOT NULL,
  classifier_score numeric CHECK (classifier_score IS NULL OR classifier_score BETWEEN 0 AND 1),
  remediation      text,
  fixed_at         timestamptz
);
ALTER TABLE public.aitg_findings ADD COLUMN IF NOT EXISTS finding_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.aitg_findings ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE public.aitg_findings ADD COLUMN IF NOT EXISTS payload_id uuid;
ALTER TABLE public.aitg_findings ADD COLUMN IF NOT EXISTS severity aitg_severity;
ALTER TABLE public.aitg_findings ADD COLUMN IF NOT EXISTS observed jsonb;
ALTER TABLE public.aitg_findings ADD COLUMN IF NOT EXISTS classifier_score numeric;
ALTER TABLE public.aitg_findings ADD COLUMN IF NOT EXISTS remediation text;
ALTER TABLE public.aitg_findings ADD COLUMN IF NOT EXISTS fixed_at timestamptz;
\ir sql/tables/aitg_findings.sql

-- aitg_waivers
CREATE TABLE IF NOT EXISTS public.aitg_waivers (
  waiver_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id       text NOT NULL REFERENCES public.aitg_test_catalog(test_id),
  scope         jsonb NOT NULL,
  justification text NOT NULL CHECK (length(justification) >= 20),
  approved_by   uuid NOT NULL REFERENCES aisha_auth.users(id),
  expires_at    timestamptz NOT NULL CHECK (expires_at > now()),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitg_waivers ADD COLUMN IF NOT EXISTS waiver_id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.aitg_waivers ADD COLUMN IF NOT EXISTS test_id text;
ALTER TABLE public.aitg_waivers ADD COLUMN IF NOT EXISTS scope jsonb;
ALTER TABLE public.aitg_waivers ADD COLUMN IF NOT EXISTS justification text;
ALTER TABLE public.aitg_waivers ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.aitg_waivers ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.aitg_waivers ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/aitg_waivers.sql

-- audience_broker_sync_state
CREATE TABLE IF NOT EXISTS public.audience_broker_sync_state (
  source_slug text NOT NULL,
  last_sync_started_at timestamp with time zone,
  last_sync_finished_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_error_at timestamp with time zone,
  last_error_message text,
  consecutive_failures integer DEFAULT 0 NOT NULL,
  total_syncs bigint DEFAULT 0 NOT NULL,
  total_failures bigint DEFAULT 0 NOT NULL,
  last_recent_active_count integer,
  last_upserted_count integer,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (source_slug)
);
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS source_slug text;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS last_sync_started_at timestamp with time zone;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS last_sync_finished_at timestamp with time zone;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS last_success_at timestamp with time zone;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS last_error_at timestamp with time zone;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS last_error_message text;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS consecutive_failures integer DEFAULT 0 NOT NULL;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS total_syncs bigint DEFAULT 0 NOT NULL;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS total_failures bigint DEFAULT 0 NOT NULL;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS last_recent_active_count integer;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS last_upserted_count integer;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.audience_broker_sync_state ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/audience_broker_sync_state.sql

-- ai_run_critic_iterations
CREATE TABLE IF NOT EXISTS public.ai_run_critic_iterations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ai_run_id uuid NOT NULL,
  iteration smallint NOT NULL,
  faithfulness_estimate numeric(4,3),
  context_recall_estimate numeric(4,3),
  retrieved_chunk_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  retrieval_strategy text,
  decision text NOT NULL,
  judge_model text,
  judge_provider_slug text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  audit_journal_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ai_run_critic_iterations_decision_check CHECK ((decision = ANY (ARRAY['stop_threshold_met'::text, 'stop_iter_cap'::text, 'continue'::text]))),
  CONSTRAINT ai_run_critic_iterations_faithfulness_estimate_check CHECK (((faithfulness_estimate IS NULL) OR ((faithfulness_estimate >= (0)::numeric) AND (faithfulness_estimate <= (1)::numeric)))),
  CONSTRAINT ai_run_critic_iterations_retrieval_strategy_check CHECK ((retrieval_strategy = ANY (ARRAY['initial'::text, 'expand_tags'::text, 'switch_profile'::text, 'broaden_threshold'::text, 'add_kb_layer'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT ai_run_critic_iterations_ai_run_id_iteration_key UNIQUE (ai_run_id, iteration),
  CONSTRAINT ai_run_critic_iterations_ai_run_id_fkey FOREIGN KEY (ai_run_id) REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  CONSTRAINT ai_run_critic_iterations_audit_journal_id_fkey FOREIGN KEY (audit_journal_id) REFERENCES public.audit_journal(id) ON DELETE SET NULL
);
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS ai_run_id uuid;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS iteration smallint;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS faithfulness_estimate numeric(4,3);
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS context_recall_estimate numeric(4,3);
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS retrieved_chunk_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS retrieval_strategy text;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS decision text;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS judge_model text;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS judge_provider_slug text;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS audit_journal_id uuid;
ALTER TABLE public.ai_run_critic_iterations ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/ai_run_critic_iterations.sql

-- delivery_statuses
CREATE TABLE IF NOT EXISTS public.delivery_statuses (
  status text PRIMARY KEY,
  label_i18n_key text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  swimlane_color text,
  requires_approval boolean NOT NULL DEFAULT false,
  restricts_actions boolean NOT NULL DEFAULT false,
  is_terminal boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS label_i18n_key text;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS swimlane_color text;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS restricts_actions boolean NOT NULL DEFAULT false;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS is_terminal boolean NOT NULL DEFAULT false;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.delivery_statuses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/delivery_statuses.sql

-- dirigent_nudges
CREATE TABLE IF NOT EXISTS public.dirigent_nudges (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid,
  conversation_id text,
  event_origin text NOT NULL,
  severity text NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  consumed_at timestamp with time zone,
  expires_at timestamp with time zone DEFAULT (now() + interval '1 hour') NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT dirigent_nudges_severity_check CHECK (severity IN ('info','warn','goal-correction')),
  CONSTRAINT dirigent_nudges_origin_check CHECK (event_origin IN
  ('wf_dirigent_agent','compliance_engine','goal_evaluator','manual','scheduled'))
);
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS conversation_id text;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS event_origin text;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS consumed_at timestamp with time zone;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone DEFAULT (now() + interval '1 hour') NOT NULL;
ALTER TABLE public.dirigent_nudges ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/dirigent_nudges.sql

-- flowboard_graphs
CREATE TABLE IF NOT EXISTS public.flowboard_graphs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text,
  name         text        NOT NULL DEFAULT 'Nový flow',
  graph        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  version      integer     NOT NULL DEFAULT 1,
  status       text        NOT NULL DEFAULT 'draft',
  engine_pin   text,
  created_by   uuid        REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Nový flow';
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS graph jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS engine_pin text;
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.flowboard_graphs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/flowboard_graphs.sql

-- intranet_chat_channels
CREATE TABLE IF NOT EXISTS public.intranet_chat_channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  channel_type  text NOT NULL DEFAULT 'general'
  CHECK (channel_type IN ('general', 'team', 'project', 'direct')),
  description   text,
  is_default    boolean NOT NULL DEFAULT false,
  is_archived   boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES aisha_auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS channel_type text NOT NULL DEFAULT 'general';
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.intranet_chat_channels ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/intranet_chat_channels.sql

-- intranet_chat_members
CREATE TABLE IF NOT EXISTS public.intranet_chat_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES intranet_chat_channels(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member'
  CHECK (role IN ('member', 'admin')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id, user_id)
);
ALTER TABLE public.intranet_chat_members ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.intranet_chat_members ADD COLUMN IF NOT EXISTS channel_id uuid;
ALTER TABLE public.intranet_chat_members ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.intranet_chat_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
ALTER TABLE public.intranet_chat_members ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/intranet_chat_members.sql

-- intranet_chat_messages
CREATE TABLE IF NOT EXISTS public.intranet_chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES intranet_chat_channels(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES aisha_auth.users(id),
  content       text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_edited     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.intranet_chat_messages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.intranet_chat_messages ADD COLUMN IF NOT EXISTS channel_id uuid;
ALTER TABLE public.intranet_chat_messages ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.intranet_chat_messages ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.intranet_chat_messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.intranet_chat_messages ADD COLUMN IF NOT EXISTS is_edited boolean NOT NULL DEFAULT false;
ALTER TABLE public.intranet_chat_messages ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.intranet_chat_messages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/intranet_chat_messages.sql

-- lead_submissions
CREATE TABLE IF NOT EXISTS public.lead_submissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL DEFAULT 'website',
  name        text        NOT NULL,
  contact     text        NOT NULL,
  subject     text,
  message     text        NOT NULL,
  locale      text,
  status      text        NOT NULL DEFAULT 'new',
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_submissions_status_valid
  CHECK (status IN ('new', 'read', 'archived', 'spam')),
  CONSTRAINT lead_submissions_name_len
  CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT lead_submissions_contact_len
  CHECK (char_length(contact) BETWEEN 1 AND 320),
  CONSTRAINT lead_submissions_message_len
  CHECK (char_length(message) BETWEEN 1 AND 5000),
  CONSTRAINT lead_submissions_source_len
  CHECK (char_length(source) BETWEEN 1 AND 100),
  CONSTRAINT lead_submissions_subject_len
  CHECK (subject IS NULL OR char_length(subject) <= 200)
);
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'website';
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS locale text;
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.lead_submissions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/lead_submissions.sql

-- llm_tier_defaults
CREATE TABLE IF NOT EXISTS public.llm_tier_defaults (
  tier text PRIMARY KEY,
  daily_token_limit int NOT NULL CHECK (daily_token_limit >= 0),
  daily_cost_limit numeric(10,4) NOT NULL CHECK (daily_cost_limit >= 0),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.llm_tier_defaults ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE public.llm_tier_defaults ADD COLUMN IF NOT EXISTS daily_token_limit int;
ALTER TABLE public.llm_tier_defaults ADD COLUMN IF NOT EXISTS daily_cost_limit numeric(10,4);
ALTER TABLE public.llm_tier_defaults ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.llm_tier_defaults ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.llm_tier_defaults ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/llm_tier_defaults.sql

-- llm_quota
CREATE TABLE IF NOT EXISTS public.llm_quota (
  user_id uuid PRIMARY KEY
  REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'free'
  REFERENCES public.llm_tier_defaults(tier) ON UPDATE CASCADE,
  daily_token_limit int NOT NULL CHECK (daily_token_limit >= 0),
  daily_cost_limit numeric(10,4) NOT NULL CHECK (daily_cost_limit >= 0),
  consumed_tokens_today int NOT NULL DEFAULT 0 CHECK (consumed_tokens_today >= 0),
  consumed_cost_today numeric(10,4) NOT NULL DEFAULT 0 CHECK (consumed_cost_today >= 0),
  last_reset_at timestamptz NOT NULL DEFAULT date_trunc('day', now()),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'free';
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS daily_token_limit int;
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS daily_cost_limit numeric(10,4);
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS consumed_tokens_today int NOT NULL DEFAULT 0;
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS consumed_cost_today numeric(10,4) NOT NULL DEFAULT 0;
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS last_reset_at timestamptz NOT NULL DEFAULT date_trunc('day', now());
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.llm_quota ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/llm_quota.sql

-- mcp_server_registry
CREATE TABLE IF NOT EXISTS public.mcp_server_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  transport text NOT NULL CHECK (transport IN ('http', 'sse', 'stdio', 'websocket')),
  endpoint_url text,
  stdio_command text[],
  auth_kind text NOT NULL DEFAULT 'bearer' CHECK (auth_kind IN ('bearer', 'api_key_header', 'none', 'oauth2')),
  auth_env_var text,
  capability_tags text[] DEFAULT '{}'::text[],
  exposes_llm boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'tested_ok', 'tested_failed', 'enabled', 'in_use', 'deprecated', 'rejected')),
  last_tested_at timestamptz,
  last_test_result jsonb,
  test_failure_count int NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto_discovery', 'partner_provided')),
  registered_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS transport text;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS endpoint_url text;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS stdio_command text[];
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS auth_kind text NOT NULL DEFAULT 'bearer';
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS auth_env_var text;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS capability_tags text[] DEFAULT '{}'::text[];
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS exposes_llm boolean NOT NULL DEFAULT false;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'discovered';
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS last_tested_at timestamptz;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS last_test_result jsonb;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS test_failure_count int NOT NULL DEFAULT 0;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS registered_by uuid;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.mcp_server_registry ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/mcp_server_registry.sql

-- message_user_feedback
CREATE TABLE IF NOT EXISTS public.message_user_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ai_run_id uuid NOT NULL,
  user_id uuid,
  rating smallint NOT NULL,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  audit_journal_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT message_user_feedback_rating_check CHECK ((rating = ANY (ARRAY['-1'::integer, 0, 1]))),
  PRIMARY KEY (id),
  CONSTRAINT message_user_feedback_ai_run_id_user_id_key UNIQUE (ai_run_id, user_id),
  CONSTRAINT message_user_feedback_ai_run_id_fkey FOREIGN KEY (ai_run_id) REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  CONSTRAINT message_user_feedback_audit_journal_id_fkey FOREIGN KEY (audit_journal_id) REFERENCES public.audit_journal(id) ON DELETE SET NULL,
  CONSTRAINT message_user_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.message_user_feedback ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.message_user_feedback ADD COLUMN IF NOT EXISTS ai_run_id uuid;
ALTER TABLE public.message_user_feedback ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.message_user_feedback ADD COLUMN IF NOT EXISTS rating smallint;
ALTER TABLE public.message_user_feedback ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.message_user_feedback ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.message_user_feedback ADD COLUMN IF NOT EXISTS audit_journal_id uuid;
ALTER TABLE public.message_user_feedback ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/message_user_feedback.sql

-- openclaw_notifications
CREATE TABLE IF NOT EXISTS public.openclaw_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('telegram', 'slack', 'matrix', 'discord', 'email', 'in_app')),
  recipient text,
  template text NOT NULL DEFAULT 'plain',
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued'
  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  sent_at timestamptz,
  error text,
  agent_slug text DEFAULT 'aisha',
  related_run_id uuid REFERENCES public.ai_runs(id),
  story_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS recipient text;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT 'plain';
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued';
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 5;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS agent_slug text DEFAULT 'aisha';
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS related_run_id uuid;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.openclaw_notifications ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/openclaw_notifications.sql

-- branding_hostname_mapping
CREATE TABLE IF NOT EXISTS public.branding_hostname_mapping (
  hostname              text PRIMARY KEY,
  branding_profile_id   uuid NOT NULL
  REFERENCES public.branding_profiles(id)
  ON UPDATE CASCADE ON DELETE RESTRICT,
  brand_variant         text NOT NULL
  CHECK (brand_variant ~ '^[a-z][a-z0-9_-]*$'),
  primary_route         text,
  secondary_route       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.branding_hostname_mapping ADD COLUMN IF NOT EXISTS hostname text;
ALTER TABLE public.branding_hostname_mapping ADD COLUMN IF NOT EXISTS branding_profile_id uuid;
ALTER TABLE public.branding_hostname_mapping ADD COLUMN IF NOT EXISTS brand_variant text;
ALTER TABLE public.branding_hostname_mapping ADD COLUMN IF NOT EXISTS primary_route text;
ALTER TABLE public.branding_hostname_mapping ADD COLUMN IF NOT EXISTS secondary_route text;
ALTER TABLE public.branding_hostname_mapping ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.branding_hostname_mapping ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/branding_hostname_mapping.sql

-- personality_signals
CREATE TABLE IF NOT EXISTS public.personality_signals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  signal_type text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb NOT NULL,
  weight real DEFAULT 0.5 NOT NULL,
  conversation_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT personality_signals_weight_check CHECK (((weight >= (0.0)::double precision) AND (weight <= (1.0)::double precision))),
  PRIMARY KEY (id),
  CONSTRAINT personality_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.personality_signals ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.personality_signals ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.personality_signals ADD COLUMN IF NOT EXISTS signal_type text;
ALTER TABLE public.personality_signals ADD COLUMN IF NOT EXISTS value jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.personality_signals ADD COLUMN IF NOT EXISTS weight real DEFAULT 0.5 NOT NULL;
ALTER TABLE public.personality_signals ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE public.personality_signals ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/personality_signals.sql

-- plugin_catalog
CREATE TABLE IF NOT EXISTS public.plugin_catalog (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  name text,
  description text,
  author text,
  kind public.plugin_kind NOT NULL,
  trust_tier public.plugin_trust_tier DEFAULT 'external'::public.plugin_trust_tier NOT NULL,
  status public.plugin_status DEFAULT 'submitted'::public.plugin_status NOT NULL,
  capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
  config_schema jsonb,
  sandbox_policy jsonb,
  lifecycle jsonb,
  agent_spec jsonb,
  author_partner_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_catalog_slug_key UNIQUE (slug)
);
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS author text;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS kind public.plugin_kind;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS trust_tier public.plugin_trust_tier DEFAULT 'external'::public.plugin_trust_tier NOT NULL;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS status public.plugin_status DEFAULT 'submitted'::public.plugin_status NOT NULL;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS capabilities jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS config_schema jsonb;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS sandbox_policy jsonb;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS lifecycle jsonb;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS agent_spec jsonb;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS author_partner_id uuid;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/plugin_catalog.sql

-- plugin_audit_events
CREATE TABLE IF NOT EXISTS public.plugin_audit_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_audit_events_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);
ALTER TABLE public.plugin_audit_events ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.plugin_audit_events ADD COLUMN IF NOT EXISTS plugin_id uuid;
ALTER TABLE public.plugin_audit_events ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE public.plugin_audit_events ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.plugin_audit_events ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.plugin_audit_events ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/plugin_audit_events.sql

-- plugin_health_events
CREATE TABLE IF NOT EXISTS public.plugin_health_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  tenant_id uuid,
  event_kind public.plugin_health_event_kind NOT NULL,
  latency_ms integer,
  error_text text,
  metadata jsonb DEFAULT '{}'::jsonb,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_health_events_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);
ALTER TABLE public.plugin_health_events ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.plugin_health_events ADD COLUMN IF NOT EXISTS plugin_id uuid;
ALTER TABLE public.plugin_health_events ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.plugin_health_events ADD COLUMN IF NOT EXISTS event_kind public.plugin_health_event_kind;
ALTER TABLE public.plugin_health_events ADD COLUMN IF NOT EXISTS latency_ms integer;
ALTER TABLE public.plugin_health_events ADD COLUMN IF NOT EXISTS error_text text;
ALTER TABLE public.plugin_health_events ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.plugin_health_events ADD COLUMN IF NOT EXISTS recorded_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/plugin_health_events.sql

-- plugin_kv
CREATE TABLE IF NOT EXISTS public.plugin_kv (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_kv_plugin_id_tenant_id_key_key UNIQUE (plugin_id, tenant_id, key),
  CONSTRAINT plugin_kv_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);
ALTER TABLE public.plugin_kv ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.plugin_kv ADD COLUMN IF NOT EXISTS plugin_id uuid;
ALTER TABLE public.plugin_kv ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.plugin_kv ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE public.plugin_kv ADD COLUMN IF NOT EXISTS value jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.plugin_kv ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.plugin_kv ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/plugin_kv.sql

-- plugin_schedules
CREATE TABLE IF NOT EXISTS public.plugin_schedules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  cron_expr text NOT NULL,
  handler_capability text NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_schedules_plugin_id_tenant_id_handler_capability_key UNIQUE (plugin_id, tenant_id, handler_capability),
  CONSTRAINT plugin_schedules_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS plugin_id uuid;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS cron_expr text;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS handler_capability text;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS last_run_at timestamp with time zone;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS next_run_at timestamp with time zone;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.plugin_schedules ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/plugin_schedules.sql

-- plugin_tenant_overrides
CREATE TABLE IF NOT EXISTS public.plugin_tenant_overrides (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  config_override jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_tenant_overrides_plugin_id_tenant_id_key UNIQUE (plugin_id, tenant_id),
  CONSTRAINT plugin_tenant_overrides_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE
);
ALTER TABLE public.plugin_tenant_overrides ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.plugin_tenant_overrides ADD COLUMN IF NOT EXISTS plugin_id uuid;
ALTER TABLE public.plugin_tenant_overrides ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.plugin_tenant_overrides ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.plugin_tenant_overrides ADD COLUMN IF NOT EXISTS config_override jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.plugin_tenant_overrides ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.plugin_tenant_overrides ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/plugin_tenant_overrides.sql

-- plugin_transition_rules
CREATE TABLE IF NOT EXISTS public.plugin_transition_rules (
  id integer DEFAULT nextval('plugin_transition_rules_id_seq'::regclass) NOT NULL,
  from_status public.plugin_status NOT NULL,
  to_status public.plugin_status NOT NULL,
  requires_role text,
  description text,
  PRIMARY KEY (id),
  CONSTRAINT plugin_transition_rules_from_status_to_status_key UNIQUE (from_status, to_status)
);
ALTER TABLE public.plugin_transition_rules ADD COLUMN IF NOT EXISTS id integer DEFAULT nextval('plugin_transition_rules_id_seq'::regclass) NOT NULL;
ALTER TABLE public.plugin_transition_rules ADD COLUMN IF NOT EXISTS from_status public.plugin_status;
ALTER TABLE public.plugin_transition_rules ADD COLUMN IF NOT EXISTS to_status public.plugin_status;
ALTER TABLE public.plugin_transition_rules ADD COLUMN IF NOT EXISTS requires_role text;
ALTER TABLE public.plugin_transition_rules ADD COLUMN IF NOT EXISTS description text;
\ir sql/tables/plugin_transition_rules.sql

-- plugin_versions
CREATE TABLE IF NOT EXISTS public.plugin_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plugin_id uuid NOT NULL,
  version text NOT NULL,
  artifact_sha256 text NOT NULL,
  artifact_url text NOT NULL,
  changelog text,
  resolved_deps jsonb,
  submitted_by uuid,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT plugin_versions_plugin_id_version_key UNIQUE (plugin_id, version),
  CONSTRAINT plugin_versions_plugin_id_fkey FOREIGN KEY (plugin_id) REFERENCES public.plugin_catalog(id) ON DELETE CASCADE,
  CONSTRAINT plugin_versions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT plugin_versions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES aisha_auth.users(id)
);
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS plugin_id uuid;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS version text;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS artifact_sha256 text;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS artifact_url text;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS changelog text;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS resolved_deps jsonb;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS submitted_by uuid;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;
ALTER TABLE public.plugin_versions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/plugin_versions.sql

-- rag_eval_baselines
CREATE TABLE IF NOT EXISTS public.rag_eval_baselines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  context_profile_slug text,
  embedding_model text,
  llm_model text,
  n_runs integer DEFAULT 0 NOT NULL,
  faithfulness_avg numeric(4,3),
  answer_relevancy_avg numeric(4,3),
  context_precision_avg numeric(4,3),
  context_recall_avg numeric(4,3),
  composite_avg numeric(4,3),
  faithfulness_p50 numeric(4,3),
  faithfulness_p90 numeric(4,3),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT rag_eval_baselines_period_start_period_end_context_profile__key UNIQUE (period_start, period_end, context_profile_slug, embedding_model, llm_model)
);
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS period_start timestamp with time zone;
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS period_end timestamp with time zone;
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS context_profile_slug text;
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS llm_model text;
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS n_runs integer DEFAULT 0 NOT NULL;
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS faithfulness_avg numeric(4,3);
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS answer_relevancy_avg numeric(4,3);
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS context_precision_avg numeric(4,3);
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS context_recall_avg numeric(4,3);
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS composite_avg numeric(4,3);
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS faithfulness_p50 numeric(4,3);
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS faithfulness_p90 numeric(4,3);
ALTER TABLE public.rag_eval_baselines ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/rag_eval_baselines.sql

-- signal_tag_rules
CREATE TABLE IF NOT EXISTS public.signal_tag_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_type_pattern text NOT NULL,
  source_pattern text,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  priority integer DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  description text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS event_type_pattern text;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS source_pattern text;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS priority integer DEFAULT 100 NOT NULL;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.signal_tag_rules ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/signal_tag_rules.sql

-- story_goal_state
CREATE TABLE IF NOT EXISTS public.story_goal_state (
  story_id uuid NOT NULL,
  acceptance_criteria jsonb NOT NULL,
  last_evaluated_at timestamp with time zone,
  loop_iterations integer DEFAULT 0 NOT NULL,
  loop_max integer DEFAULT 12 NOT NULL,
  fingerprint text,
  last_evaluator_output jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (story_id),
  CONSTRAINT story_goal_state_loop_max_check CHECK (loop_max BETWEEN 1 AND 100),
  CONSTRAINT story_goal_state_loop_iter_check CHECK (loop_iterations >= 0)
);
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb;
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS last_evaluated_at timestamp with time zone;
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS loop_iterations integer DEFAULT 0 NOT NULL;
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS loop_max integer DEFAULT 12 NOT NULL;
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS fingerprint text;
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS last_evaluator_output jsonb;
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.story_goal_state ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/story_goal_state.sql

-- graph_nodes
CREATE TABLE IF NOT EXISTS public.graph_nodes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL CHECK (entity_type IN (
  'Story', 'Agent', 'Plugin', 'KnowledgeItem', 'ExpertRule',
  'User', 'AuditEvent', 'Run', 'Memory', 'Proposal', 'Concept'
  )),
  entity_slug  text,
  entity_label text NOT NULL,
  source_table text,
  source_id    uuid,
  embedding    vector(2560),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  story_id     uuid REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_slug, story_id)
);
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS entity_slug text;
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS entity_label text;
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS source_table text;
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS embedding vector(2560);
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/graph_nodes.sql

-- graph_edges
CREATE TABLE IF NOT EXISTS public.graph_edges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id           uuid NOT NULL REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
  target_node_id           uuid NOT NULL REFERENCES public.graph_nodes(id) ON DELETE CASCADE,
  relationship             text NOT NULL CHECK (relationship IN (
  'USED', 'CITED', 'CAUSED', 'ESCALATED_TO', 'OVERRIDDEN_BY',
  'REFERENCES', 'AUTHORED', 'OWNED_BY', 'DERIVED_FROM', 'PART_OF',
  'PROPOSED_FOR', 'PROMOTED_FROM', 'TAGGED_AS'
  )),
  confidence               numeric(4, 3) DEFAULT 1.0
  CHECK (confidence BETWEEN 0 AND 1),
  source_audit_journal_id  uuid REFERENCES public.audit_journal(id) ON DELETE SET NULL,
  source_ai_run_id         uuid REFERENCES public.ai_runs(id) ON DELETE SET NULL,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_node_id, target_node_id, relationship)
);
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS source_node_id uuid;
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS target_node_id uuid;
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS relationship text;
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS confidence numeric(4, 3) DEFAULT 1.0;
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS source_audit_journal_id uuid;
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS source_ai_run_id uuid;
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.graph_edges ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/graph_edges.sql

-- knowledge_multimodal_pages
CREATE TABLE IF NOT EXISTS public.knowledge_multimodal_pages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  knowledge_item_id uuid NOT NULL,
  page_number integer NOT NULL,
  page_image_uri text,
  page_image_sha256 text,
  page_text text,
  embedding_v2 halfvec(2560),
  embedding_model text,
  embedding_version text,
  embedding_generated_at timestamp with time zone,
  status text DEFAULT 'pending'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_multimodal_pages_page_number_check CHECK ((page_number > 0)),
  CONSTRAINT knowledge_multimodal_pages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'embedded'::text, 'failed'::text, 'skipped'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT knowledge_multimodal_pages_knowledge_item_id_page_number_key UNIQUE (knowledge_item_id, page_number),
  CONSTRAINT knowledge_multimodal_pages_knowledge_item_id_fkey FOREIGN KEY (knowledge_item_id) REFERENCES public.knowledge_items(id) ON DELETE CASCADE
);
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS knowledge_item_id uuid;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS page_number integer;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS page_image_uri text;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS page_image_sha256 text;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS page_text text;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS embedding_v2 halfvec(2560);
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS embedding_version text;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS embedding_generated_at timestamp with time zone;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.knowledge_multimodal_pages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/knowledge_multimodal_pages.sql

-- agent_knowledge_bindings
CREATE TABLE IF NOT EXISTS public.agent_knowledge_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_slug text NOT NULL,
  knowledge_item_id uuid NOT NULL
  REFERENCES public.expert_rules(id) ON DELETE CASCADE,
  binding_type text NOT NULL DEFAULT 'rule',
  priority int NOT NULL DEFAULT 100,
  version int,
  is_active boolean NOT NULL DEFAULT true,
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS agent_slug text;
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS knowledge_item_id uuid;
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS binding_type text NOT NULL DEFAULT 'rule';
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 100;
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS version int;
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.agent_knowledge_bindings ADD COLUMN IF NOT EXISTS created_by uuid;
\ir sql/tables/agent_knowledge_bindings.sql

-- playwright_runs
CREATE TABLE IF NOT EXISTS public.playwright_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  trigger_kind public.playwright_run_trigger NOT NULL,
  target_env text NOT NULL,
  target_base_url text NOT NULL,
  suite text NOT NULL DEFAULT 'all',
  deploy_ref text,
  status public.playwright_run_status NOT NULL DEFAULT 'queued',
  total integer,
  passed integer,
  failed integer,
  skipped integer,
  duration_ms integer,
  report_storage_path text,
  trace_json_path text,
  error_message text,
  requested_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  approval_required boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_name text,
  active_slot text CHECK (active_slot IN ('blue', 'green')),
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE SET NULL,
  triggered_rollback_id uuid REFERENCES public.rollback_history(id) ON DELETE SET NULL,
  PRIMARY KEY (id)
);
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS trigger_kind public.playwright_run_trigger;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS target_env text;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS target_base_url text;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS suite text NOT NULL DEFAULT 'all';
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS deploy_ref text;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS status public.playwright_run_status NOT NULL DEFAULT 'queued';
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS total integer;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS passed integer;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS failed integer;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS skipped integer;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS report_storage_path text;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS trace_json_path text;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS requested_by uuid;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS app_name text;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS active_slot text;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.playwright_runs ADD COLUMN IF NOT EXISTS triggered_rollback_id uuid;
\ir sql/tables/playwright_runs.sql

-- rag_eval_golden
CREATE TABLE IF NOT EXISTS public.rag_eval_golden (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  question text NOT NULL,
  ground_truth_answer text NOT NULL,
  expected_chunk_slugs text[] DEFAULT '{}'::text[],
  context_profile_slug text,
  expertise_area_slug text,
  story_id uuid,
  difficulty smallint,
  language text DEFAULT 'en'::text,
  status text DEFAULT 'active'::text,
  tags text[] DEFAULT '{}'::text[],
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT rag_eval_golden_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 5))),
  CONSTRAINT rag_eval_golden_language_check CHECK ((language = ANY (ARRAY['cs'::text, 'en'::text]))),
  CONSTRAINT rag_eval_golden_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text, 'draft'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT rag_eval_golden_slug_key UNIQUE (slug),
  CONSTRAINT rag_eval_golden_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT rag_eval_golden_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE
);
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS question text;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS ground_truth_answer text;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS expected_chunk_slugs text[] DEFAULT '{}'::text[];
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS context_profile_slug text;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS expertise_area_slug text;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS difficulty smallint;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS language text DEFAULT 'en'::text;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[];
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.rag_eval_golden ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/rag_eval_golden.sql

-- rag_eval_runs
CREATE TABLE IF NOT EXISTS public.rag_eval_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  golden_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  embedding_model text NOT NULL,
  embedding_model_version text,
  llm_model text NOT NULL,
  judge_model text,
  context_profile_slug text,
  retrieved_chunk_ids uuid[] DEFAULT '{}'::uuid[],
  retrieved_chunk_count integer GENERATED ALWAYS AS (COALESCE(array_length(retrieved_chunk_ids, 1), 0)) STORED,
  generated_answer text,
  faithfulness_score numeric(4,3),
  answer_relevancy_score numeric(4,3),
  context_precision_score numeric(4,3),
  context_recall_score numeric(4,3),
  composite_score numeric(4,3) GENERATED ALWAYS AS (
  CASE
  WHEN ((faithfulness_score IS NULL) OR (answer_relevancy_score IS NULL) OR (context_precision_score IS NULL) OR (context_recall_score IS NULL)) THEN NULL::numeric
  ELSE round(((((faithfulness_score * 0.4) + (answer_relevancy_score * 0.2)) + (context_precision_score * 0.2)) + (context_recall_score * 0.2)), 3)
  END) STORED,
  latency_ms integer,
  cost numeric(10,6),
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  ai_run_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT rag_eval_runs_answer_relevancy_score_check CHECK (((answer_relevancy_score IS NULL) OR ((answer_relevancy_score >= (0)::numeric) AND (answer_relevancy_score <= (1)::numeric)))),
  CONSTRAINT rag_eval_runs_context_precision_score_check CHECK (((context_precision_score IS NULL) OR ((context_precision_score >= (0)::numeric) AND (context_precision_score <= (1)::numeric)))),
  CONSTRAINT rag_eval_runs_context_recall_score_check CHECK (((context_recall_score IS NULL) OR ((context_recall_score >= (0)::numeric) AND (context_recall_score <= (1)::numeric)))),
  CONSTRAINT rag_eval_runs_faithfulness_score_check CHECK (((faithfulness_score IS NULL) OR ((faithfulness_score >= (0)::numeric) AND (faithfulness_score <= (1)::numeric)))),
  PRIMARY KEY (id),
  CONSTRAINT rag_eval_runs_ai_run_id_fkey FOREIGN KEY (ai_run_id) REFERENCES public.ai_runs(id) ON DELETE SET NULL,
  CONSTRAINT rag_eval_runs_golden_id_fkey FOREIGN KEY (golden_id) REFERENCES public.rag_eval_golden(id) ON DELETE CASCADE
);
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS golden_id uuid;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS embedding_model_version text;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS llm_model text;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS judge_model text;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS context_profile_slug text;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS retrieved_chunk_ids uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS retrieved_chunk_count integer GENERATED ALWAYS AS (COALESCE(array_length(retrieved_chunk_ids, 1), 0)) STORED;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS generated_answer text;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS faithfulness_score numeric(4,3);
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS answer_relevancy_score numeric(4,3);
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS context_precision_score numeric(4,3);
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS context_recall_score numeric(4,3);
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS composite_score numeric(4,3) GENERATED ALWAYS AS ( CASE WHEN ((faithfulness_score IS NULL) OR (answer_relevancy_score IS NULL) OR (context_precision_score IS NULL) OR (context_recall_score IS NULL)) THEN NULL::numeric ELSE round(((((faithfulness_score * 0.4) + (answer_relevancy_score * 0.2)) + (context_precision_score * 0.2)) + (context_recall_score * 0.2)), 3) END) STORED;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS latency_ms integer;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS cost numeric(10,6);
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS ai_run_id uuid;
ALTER TABLE public.rag_eval_runs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/rag_eval_runs.sql

-- sla_tracking
CREATE TABLE IF NOT EXISTS public.sla_tracking (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  matrix_room_id text NOT NULL,
  first_message_at timestamp with time zone,
  first_response_at timestamp with time zone,
  response_time_ms integer GENERATED ALWAYS AS (
  CASE
  WHEN ((first_response_at IS NOT NULL) AND (first_message_at IS NOT NULL)) THEN (EXTRACT(epoch FROM (first_response_at - first_message_at)) * (1000)::numeric)
  ELSE NULL::numeric
  END) STORED,
  sla_breached boolean DEFAULT false NOT NULL,
  escalated_at timestamp with time zone,
  escalated_to uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT sla_tracking_escalated_to_fkey FOREIGN KEY (escalated_to) REFERENCES aisha_auth.users(id),
  CONSTRAINT sla_tracking_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE
);
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS matrix_room_id text;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS first_message_at timestamp with time zone;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS first_response_at timestamp with time zone;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS response_time_ms integer GENERATED ALWAYS AS ( CASE WHEN ((first_response_at IS NOT NULL) AND (first_message_at IS NOT NULL)) THEN (EXTRACT(epoch FROM (first_response_at - first_message_at)) * (1000)::numeric) ELSE NULL::numeric END) STORED;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS sla_breached boolean DEFAULT false NOT NULL;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS escalated_at timestamp with time zone;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS escalated_to uuid;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sla_tracking ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/sla_tracking.sql

-- story_matrix_rooms
CREATE TABLE IF NOT EXISTS public.story_matrix_rooms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  story_id uuid NOT NULL,
  matrix_room_id text NOT NULL,
  room_type text DEFAULT 'general'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  bridge_type text,
  display_name text,
  CONSTRAINT story_matrix_rooms_room_type_check CHECK ((room_type = ANY (ARRAY['general'::text, 'voice'::text, 'bridge'::text, 'bot'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT story_matrix_rooms_story_id_room_type_key UNIQUE (story_id, room_type),
  CONSTRAINT story_matrix_rooms_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE
);
ALTER TABLE public.story_matrix_rooms ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.story_matrix_rooms ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.story_matrix_rooms ADD COLUMN IF NOT EXISTS matrix_room_id text;
ALTER TABLE public.story_matrix_rooms ADD COLUMN IF NOT EXISTS room_type text DEFAULT 'general'::text NOT NULL;
ALTER TABLE public.story_matrix_rooms ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;
ALTER TABLE public.story_matrix_rooms ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.story_matrix_rooms ADD COLUMN IF NOT EXISTS bridge_type text;
ALTER TABLE public.story_matrix_rooms ADD COLUMN IF NOT EXISTS display_name text;
\ir sql/tables/story_matrix_rooms.sql

-- user_engagement_metrics
CREATE TABLE IF NOT EXISTS public.user_engagement_metrics (
  user_id uuid NOT NULL,
  app_accesses_30d integer DEFAULT 0 NOT NULL,
  app_accesses_90d integer DEFAULT 0 NOT NULL,
  last_active_at timestamp with time zone,
  events_created_30d integer DEFAULT 0 NOT NULL,
  events_created_90d integer DEFAULT 0 NOT NULL,
  posts_created_30d integer DEFAULT 0 NOT NULL,
  audience_size integer DEFAULT 0 NOT NULL,
  audience_growth_30d numeric(6,4) DEFAULT 0 NOT NULL,
  unique_attendees_30d integer DEFAULT 0 NOT NULL,
  total_attendance_30d integer DEFAULT 0 NOT NULL,
  emails_opened_90d integer DEFAULT 0 NOT NULL,
  emails_sent_90d integer DEFAULT 0 NOT NULL,
  email_open_rate_90d numeric(6,4),
  email_click_rate_90d numeric(6,4),
  source_slug text,
  computed_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id)
);
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS app_accesses_30d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS app_accesses_90d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS last_active_at timestamp with time zone;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS events_created_30d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS events_created_90d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS posts_created_30d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS audience_size integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS audience_growth_30d numeric(6,4) DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS unique_attendees_30d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS total_attendance_30d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS emails_opened_90d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS emails_sent_90d integer DEFAULT 0 NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS email_open_rate_90d numeric(6,4);
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS email_click_rate_90d numeric(6,4);
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS source_slug text;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS computed_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.user_engagement_metrics ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/user_engagement_metrics.sql

-- tracked_actions
CREATE TABLE IF NOT EXISTS public.tracked_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reminder_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT tracked_actions_reminder_id_fkey FOREIGN KEY (reminder_id) REFERENCES user_reminders(id) ON DELETE SET NULL,
  CONSTRAINT tracked_actions_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.tracked_actions ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.tracked_actions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.tracked_actions ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE public.tracked_actions ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.tracked_actions ADD COLUMN IF NOT EXISTS reminder_id uuid;
ALTER TABLE public.tracked_actions ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tracked_actions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/tracked_actions.sql

-- voice_rooms
CREATE TABLE IF NOT EXISTS public.voice_rooms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  room_type text NOT NULL,
  story_id uuid,
  livekit_room_name text NOT NULL,
  max_participants integer DEFAULT 50 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT voice_rooms_room_type_check CHECK ((room_type = ANY (ARRAY['consultation'::text, 'ptt'::text, 'group_call'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT voice_rooms_livekit_room_name_key UNIQUE (livekit_room_name),
  CONSTRAINT voice_rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id),
  CONSTRAINT voice_rooms_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE SET NULL
);
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS room_type text;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS livekit_room_name text;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS max_participants integer DEFAULT 50 NOT NULL;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.voice_rooms ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/voice_rooms.sql

-- call_events
CREATE TABLE IF NOT EXISTS public.call_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  voice_room_id uuid NOT NULL,
  user_id uuid,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT call_events_event_type_check CHECK ((event_type = ANY (ARRAY['room_created'::text, 'room_closed'::text, 'participant_joined'::text, 'participant_left'::text, 'recording_started'::text, 'recording_stopped'::text, 'ptt_activated'::text, 'ptt_deactivated'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT call_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT call_events_voice_room_id_fkey FOREIGN KEY (voice_room_id) REFERENCES public.voice_rooms(id) ON DELETE CASCADE
);
ALTER TABLE public.call_events ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.call_events ADD COLUMN IF NOT EXISTS voice_room_id uuid;
ALTER TABLE public.call_events ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.call_events ADD COLUMN IF NOT EXISTS event_type text;
ALTER TABLE public.call_events ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.call_events ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
\ir sql/tables/call_events.sql

-- call_participants
CREATE TABLE IF NOT EXISTS public.call_participants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  voice_room_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL,
  left_at timestamp with time zone,
  is_muted boolean DEFAULT false NOT NULL,
  role text DEFAULT 'participant'::text NOT NULL,
  CONSTRAINT call_participants_role_check CHECK ((role = ANY (ARRAY['host'::text, 'participant'::text, 'listener'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT call_participants_voice_room_id_user_id_key UNIQUE (voice_room_id, user_id),
  CONSTRAINT call_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT call_participants_voice_room_id_fkey FOREIGN KEY (voice_room_id) REFERENCES public.voice_rooms(id) ON DELETE CASCADE
);
ALTER TABLE public.call_participants ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.call_participants ADD COLUMN IF NOT EXISTS voice_room_id uuid;
ALTER TABLE public.call_participants ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.call_participants ADD COLUMN IF NOT EXISTS joined_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.call_participants ADD COLUMN IF NOT EXISTS left_at timestamp with time zone;
ALTER TABLE public.call_participants ADD COLUMN IF NOT EXISTS is_muted boolean DEFAULT false NOT NULL;
ALTER TABLE public.call_participants ADD COLUMN IF NOT EXISTS role text DEFAULT 'participant'::text NOT NULL;
\ir sql/tables/call_participants.sql

-- consultation_sessions
CREATE TABLE IF NOT EXISTS public.consultation_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  voice_room_id uuid NOT NULL,
  booking_id uuid,
  caller_id uuid NOT NULL,
  callee_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration_seconds integer,
  recording_consent boolean DEFAULT false NOT NULL,
  recording_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  recording_consent_at timestamp with time zone,
  recording_egress_id text,
  CONSTRAINT consultation_sessions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ringing'::text, 'active'::text, 'ended'::text, 'missed'::text, 'declined'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT consultation_sessions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.consultation_bookings(id) ON DELETE SET NULL,
  CONSTRAINT consultation_sessions_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT consultation_sessions_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES aisha_auth.users(id),
  CONSTRAINT consultation_sessions_voice_room_id_fkey FOREIGN KEY (voice_room_id) REFERENCES public.voice_rooms(id) ON DELETE CASCADE
);
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS voice_room_id uuid;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS booking_id uuid;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS caller_id uuid;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS callee_id uuid;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS ended_at timestamp with time zone;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS duration_seconds integer;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS recording_consent boolean DEFAULT false NOT NULL;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS recording_url text;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS recording_consent_at timestamp with time zone;
ALTER TABLE public.consultation_sessions ADD COLUMN IF NOT EXISTS recording_egress_id text;
\ir sql/tables/consultation_sessions.sql

-- web_artifact_jobs
CREATE TABLE IF NOT EXISTS public.web_artifact_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  kind public.web_artifact_kind NOT NULL,
  source_type public.web_artifact_source_type NOT NULL,
  status public.web_artifact_job_status NOT NULL DEFAULT 'pending',
  source_url text,
  source_storage_path text,
  seed_canvas_data jsonb,
  result_canvas_data jsonb,
  result_canvas_html text,
  result_canvas_css text,
  extracted_tokens jsonb,
  brief text,
  slot_profile text,
  creativity_seed numeric,
  idempotency_key text NOT NULL,
  applied_to_page_id uuid REFERENCES public.web_pages(id) ON DELETE SET NULL,
  applied_version_id uuid REFERENCES public.web_page_versions(id),
  error_message text,
  created_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  applied_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id),
  CONSTRAINT web_artifact_jobs_idempotency_key_unique UNIQUE (idempotency_key)
);
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS kind public.web_artifact_kind;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS source_type public.web_artifact_source_type;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS status public.web_artifact_job_status NOT NULL DEFAULT 'pending';
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS source_storage_path text;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS seed_canvas_data jsonb;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS result_canvas_data jsonb;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS result_canvas_html text;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS result_canvas_css text;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS extracted_tokens jsonb;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS brief text;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS slot_profile text;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS creativity_seed numeric;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS applied_to_page_id uuid;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS applied_version_id uuid;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS processed_at timestamptz;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE public.web_artifact_jobs ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
\ir sql/tables/web_artifact_jobs.sql

-- workbench_execution_requests
CREATE TABLE IF NOT EXISTS public.workbench_execution_requests (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  clow            jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_input   text NOT NULL,
  model_id        text,
  provider_slug   text,
  run_id          uuid,
  story_id        uuid,
  decision_id     uuid,
  status          text NOT NULL DEFAULT 'pending',
  claimed_by      text,
  response        text,
  error_detail    jsonb,
  tokens_in       integer,
  tokens_out      integer,
  latency_ms      integer,
  claim_attempts  integer NOT NULL DEFAULT 0,
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT workbench_execution_requests_status_check
  CHECK (status IN ('pending', 'claimed', 'completed', 'failed'))
);
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS clow jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS request_input text;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS provider_slug text;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS story_id uuid;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS decision_id uuid;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS claimed_by text;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS response text;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS error_detail jsonb;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS tokens_in integer;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS tokens_out integer;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS latency_ms integer;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS claim_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS enqueued_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.workbench_execution_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/workbench_execution_requests.sql

-- workflow_statuses
CREATE TABLE IF NOT EXISTS public.workflow_statuses (
  status text PRIMARY KEY,
  label_i18n_key text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  swimlane_color text,
  is_terminal boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS label_i18n_key text;
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS swimlane_color text;
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS is_terminal boolean NOT NULL DEFAULT false;
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.workflow_statuses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/workflow_statuses.sql

-- workflow_status_transitions
CREATE TABLE IF NOT EXISTS public.workflow_status_transitions (
  id integer PRIMARY KEY DEFAULT nextval('public.workflow_status_transitions_id_seq'::regclass),
  from_status text NOT NULL REFERENCES public.workflow_statuses(status),
  to_status   text NOT NULL REFERENCES public.workflow_statuses(status),
  requires_role text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_status, to_status),
  CHECK (from_status <> to_status)
);
ALTER TABLE public.workflow_status_transitions ADD COLUMN IF NOT EXISTS id integer DEFAULT nextval('public.workflow_status_transitions_id_seq'::regclass);
ALTER TABLE public.workflow_status_transitions ADD COLUMN IF NOT EXISTS from_status text;
ALTER TABLE public.workflow_status_transitions ADD COLUMN IF NOT EXISTS to_status text;
ALTER TABLE public.workflow_status_transitions ADD COLUMN IF NOT EXISTS requires_role text;
ALTER TABLE public.workflow_status_transitions ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.workflow_status_transitions ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.workflow_status_transitions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.workflow_status_transitions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
\ir sql/tables/workflow_status_transitions.sql

-- ── indexes (separate SoT files, now CREATE INDEX IF NOT EXISTS) ──
\ir sql/indexes/idx_ai_decisions_run.sql
\ir sql/indexes/idx_ai_decisions_story.sql
\ir sql/indexes/idx_ai_provider_registry_enabled.sql
\ir sql/indexes/idx_ai_provider_registry_health.sql
\ir sql/indexes/idx_ai_provider_registry_instance.sql
\ir sql/indexes/idx_ai_risk_policies_lookup.sql
\ir sql/indexes/idx_ai_batch_jobs_last_polled.sql
\ir sql/indexes/idx_ai_batch_jobs_pending.sql
\ir sql/indexes/idx_ai_batch_jobs_related_run.sql
\ir sql/indexes/idx_aisha_static_defense_rules_active.sql
\ir sql/indexes/idx_aisha_static_defense_rules_pending.sql
\ir sql/indexes/idx_aitg_reflections_recent.sql
\ir sql/indexes/idx_aitg_automation_settings_mode.sql
\ir sql/indexes/idx_aitg_drift_alerts_open.sql
\ir sql/indexes/idx_aitg_payloads_active_priority.sql
\ir sql/indexes/idx_aitg_payloads_test.sql
\ir sql/indexes/idx_aitg_payload_proposals_pending.sql
\ir sql/indexes/idx_aitg_runs_build.sql
\ir sql/indexes/idx_aitg_runs_recent.sql
\ir sql/indexes/idx_aitg_runs_status.sql
\ir sql/indexes/idx_aitg_findings_open.sql
\ir sql/indexes/idx_aitg_findings_run.sql
\ir sql/indexes/idx_aitg_findings_severity.sql
\ir sql/indexes/idx_critic_iter_decision.sql
\ir sql/indexes/idx_critic_iter_run.sql
\ir sql/indexes/idx_delivery_statuses_active_order.sql
\ir sql/indexes/idx_dirigent_nudges_expires.sql
\ir sql/indexes/idx_dirigent_nudges_pending.sql
\ir sql/indexes/flowboard_graphs_created_by_idx.sql
\ir sql/indexes/idx_intranet_chat_channels_type.sql
\ir sql/indexes/idx_intranet_chat_members_channel.sql
\ir sql/indexes/idx_intranet_chat_members_user.sql
\ir sql/indexes/idx_intranet_chat_messages_channel_created.sql
\ir sql/indexes/idx_intranet_chat_messages_user.sql
\ir sql/indexes/idx_lead_submissions_source.sql
\ir sql/indexes/idx_lead_submissions_status_created.sql
\ir sql/indexes/idx_llm_quota_consumption_today.sql
\ir sql/indexes/idx_llm_quota_tier.sql
\ir sql/indexes/idx_mcp_server_registry_capabilities.sql
\ir sql/indexes/idx_mcp_server_registry_status.sql
\ir sql/indexes/idx_message_user_feedback_rating.sql
\ir sql/indexes/idx_message_user_feedback_run.sql
\ir sql/indexes/idx_openclaw_notifications_campaign.sql
\ir sql/indexes/idx_openclaw_notifications_campaign_run.sql
\ir sql/indexes/idx_openclaw_notifications_queued.sql
\ir sql/indexes/idx_openclaw_notifications_retry.sql
\ir sql/indexes/idx_openclaw_notifications_user.sql
\ir sql/indexes/idx_branding_hostname_mapping_profile.sql
\ir sql/indexes/idx_personality_signals_created.sql
\ir sql/indexes/idx_personality_signals_user_type_time.sql
\ir sql/indexes/idx_plugin_audit_events_plugin_time.sql
\ir sql/indexes/idx_plugin_health_events_plugin_time.sql
\ir sql/indexes/idx_plugin_kv_lookup.sql
\ir sql/indexes/idx_plugin_schedules_next_run.sql
\ir sql/indexes/idx_rag_eval_baselines_period.sql
\ir sql/indexes/idx_rag_eval_baselines_profile_period.sql
\ir sql/indexes/idx_signal_tag_rules_active.sql
\ir sql/indexes/idx_signal_tag_rules_created_by.sql
\ir sql/indexes/idx_graph_nodes_label_trgm.sql
\ir sql/indexes/idx_graph_nodes_source.sql
\ir sql/indexes/idx_graph_nodes_story.sql
\ir sql/indexes/idx_graph_nodes_type.sql
\ir sql/indexes/idx_graph_edges_rel.sql
\ir sql/indexes/idx_graph_edges_run.sql
\ir sql/indexes/idx_graph_edges_source.sql
\ir sql/indexes/idx_graph_edges_target.sql
\ir sql/indexes/idx_kmm_pages_item.sql
\ir sql/indexes/idx_kmm_pages_pending.sql
\ir sql/indexes/idx_agent_knowledge_bindings_lookup.sql
\ir sql/indexes/idx_agent_knowledge_bindings_story.sql
\ir sql/indexes/uniq_agent_knowledge_bindings_active.sql
\ir sql/indexes/idx_playwright_runs_app_status.sql
\ir sql/indexes/idx_playwright_runs_created_at.sql
\ir sql/indexes/idx_playwright_runs_env_status.sql
\ir sql/indexes/idx_playwright_runs_pending_approval.sql
\ir sql/indexes/idx_rag_eval_golden_profile.sql
\ir sql/indexes/idx_rag_eval_golden_status.sql
\ir sql/indexes/idx_rag_eval_golden_story.sql
\ir sql/indexes/idx_rag_eval_runs_batch.sql
\ir sql/indexes/idx_rag_eval_runs_created.sql
\ir sql/indexes/idx_rag_eval_runs_embedding_model.sql
\ir sql/indexes/idx_rag_eval_runs_golden.sql
\ir sql/indexes/idx_rag_eval_runs_profile.sql
\ir sql/indexes/idx_sla_tracking_breached.sql
\ir sql/indexes/idx_sla_tracking_story.sql
\ir sql/indexes/idx_story_matrix_rooms_matrix.sql
\ir sql/indexes/idx_story_matrix_rooms_story.sql
\ir sql/indexes/idx_user_engagement_metrics_active.sql
\ir sql/indexes/idx_user_engagement_metrics_audience.sql
\ir sql/indexes/idx_user_engagement_metrics_computed.sql
\ir sql/indexes/tracked_actions_user_occurred_idx.sql
\ir sql/indexes/idx_voice_rooms_livekit.sql
\ir sql/indexes/idx_voice_rooms_story.sql
\ir sql/indexes/idx_call_events_room.sql
\ir sql/indexes/idx_call_participants_room.sql
\ir sql/indexes/idx_call_participants_user.sql
\ir sql/indexes/idx_consultation_sessions_callee.sql
\ir sql/indexes/idx_consultation_sessions_caller.sql
\ir sql/indexes/idx_consultation_sessions_status.sql
\ir sql/indexes/idx_web_artifact_jobs_applied_page.sql
\ir sql/indexes/idx_web_artifact_jobs_created_at.sql
\ir sql/indexes/idx_web_artifact_jobs_story_status.sql
\ir sql/indexes/idx_workbench_exec_requests_pending.sql
\ir sql/indexes/idx_workflow_statuses_active_order.sql
\ir sql/indexes/idx_workflow_status_transitions_lookup.sql

-- ── row-level security (ENABLE … is idempotent; the 6 RLS files that also
--    carry policies now DROP POLICY IF EXISTS first in their SoT) ──
\ir sql/rls/aitg_automation_settings.sql
\ir sql/rls/aitg_test_catalog.sql
\ir sql/rls/aitg_payloads.sql
\ir sql/rls/aitg_runs.sql
\ir sql/rls/aitg_findings.sql
\ir sql/rls/aitg_waivers.sql
\ir sql/rls/audience_broker_sync_state.sql
\ir sql/rls/ai_run_critic_iterations.sql
\ir sql/rls/delivery_statuses.sql
\ir sql/rls/dirigent_nudges.sql
\ir sql/rls/flowboard_graphs.sql
\ir sql/rls/llm_quota.sql
\ir sql/rls/message_user_feedback.sql
\ir sql/rls/personality_signals.sql
\ir sql/rls/plugin_catalog.sql
\ir sql/rls/plugin_audit_events.sql
\ir sql/rls/plugin_health_events.sql
\ir sql/rls/plugin_kv.sql
\ir sql/rls/plugin_schedules.sql
\ir sql/rls/plugin_tenant_overrides.sql
\ir sql/rls/plugin_transition_rules.sql
\ir sql/rls/plugin_versions.sql
\ir sql/rls/rag_eval_baselines.sql
\ir sql/rls/signal_tag_rules.sql
\ir sql/rls/story_goal_state.sql
\ir sql/rls/graph_nodes.sql
\ir sql/rls/graph_edges.sql
\ir sql/rls/knowledge_multimodal_pages.sql
\ir sql/rls/agent_knowledge_bindings.sql
\ir sql/rls/playwright_runs.sql
\ir sql/rls/rag_eval_golden.sql
\ir sql/rls/rag_eval_runs.sql
\ir sql/rls/sla_tracking.sql
\ir sql/rls/story_matrix_rooms.sql
\ir sql/rls/user_engagement_metrics.sql
\ir sql/rls/voice_rooms.sql
\ir sql/rls/call_events.sql
\ir sql/rls/call_participants.sql
\ir sql/rls/consultation_sessions.sql
\ir sql/rls/workflow_statuses.sql
\ir sql/rls/workflow_status_transitions.sql

-- ── policies (SoT files are bare CREATE POLICY by convention — the baseline
--    generator injects the drop at emit time; we inject it here the same way) ──
DROP POLICY IF EXISTS "admin_staff_read_ai_decisions" ON public.ai_decisions;
\ir sql/policies/admin_staff_read_ai_decisions.sql
DROP POLICY IF EXISTS "participant_read_ai_decisions" ON public.ai_decisions;
\ir sql/policies/participant_read_ai_decisions.sql
DROP POLICY IF EXISTS "ai_provider_registry_authenticated_read" ON public.ai_provider_registry;
\ir sql/policies/ai_provider_registry_ai_provider_registry_authenticated_read.sql
DROP POLICY IF EXISTS "ai_provider_registry_service_all" ON public.ai_provider_registry;
\ir sql/policies/ai_provider_registry_ai_provider_registry_service_all.sql
DROP POLICY IF EXISTS "ai_risk_policies_admin_manage" ON public.ai_risk_policies;
\ir sql/policies/ai_risk_policies_admin_manage.sql
DROP POLICY IF EXISTS "ai_risk_policies admin read" ON public.ai_risk_policies;
DROP POLICY IF EXISTS "ai_risk_policies service full" ON public.ai_risk_policies;
\ir sql/policies/ai_risk_policies_read.sql
DROP POLICY IF EXISTS runtime_registry_admin_manage ON public.ai_runtime_registry;
\ir sql/policies/runtime_registry_admin_manage.sql
DROP POLICY IF EXISTS "runtime_registry_read" ON public.ai_runtime_registry;
\ir sql/policies/runtime_registry_read.sql
DROP POLICY IF EXISTS aisha_static_defense_rules_admin_all ON public.aisha_static_defense_rules;
\ir sql/policies/aisha_static_defense_rules_admin_all.sql
DROP POLICY IF EXISTS "aitg_aisha_reflections_read_admin" ON public.aitg_aisha_reflections;
\ir sql/policies/aitg_aisha_reflections_aitg_aisha_reflections_read_admin.sql
DROP POLICY IF EXISTS "aitg_drift_alerts_read_admin" ON public.aitg_drift_alerts;
\ir sql/policies/aitg_drift_alerts_aitg_drift_alerts_read_admin.sql
DROP POLICY IF EXISTS "aitg_payload_proposals_read_admin" ON public.aitg_payload_proposals;
\ir sql/policies/aitg_payload_proposals_aitg_payload_proposals_read_admin.sql
DROP POLICY IF EXISTS "critic_iter admin staff read" ON public.ai_run_critic_iterations;
\ir sql/policies/critic_iter_admin_staff_read.sql
DROP POLICY IF EXISTS intranet_chat_channels_select ON public.intranet_chat_channels;
\ir sql/policies/intranet_chat_channels_select.sql
DROP POLICY IF EXISTS intranet_chat_members_manage ON public.intranet_chat_members;
\ir sql/policies/intranet_chat_members_manage.sql
DROP POLICY IF EXISTS intranet_chat_members_select ON public.intranet_chat_members;
\ir sql/policies/intranet_chat_members_select.sql
DROP POLICY IF EXISTS intranet_chat_messages_insert ON public.intranet_chat_messages;
\ir sql/policies/intranet_chat_messages_insert.sql
DROP POLICY IF EXISTS intranet_chat_messages_select ON public.intranet_chat_messages;
\ir sql/policies/intranet_chat_messages_select.sql
DROP POLICY IF EXISTS "Public web leads readable by admin staff" ON public.lead_submissions;
\ir sql/policies/Public_web_leads_readable_by_admin_staff.sql
DROP POLICY IF EXISTS "Service role full access to lead submissions" ON public.lead_submissions;
\ir sql/policies/Service_role_full_access_to_lead_submissions.sql
DROP POLICY IF EXISTS "mcp_server_registry_authenticated_read" ON public.mcp_server_registry;
\ir sql/policies/mcp_server_registry_mcp_server_registry_authenticated_read.sql
DROP POLICY IF EXISTS "mcp_server_registry_service_all" ON public.mcp_server_registry;
\ir sql/policies/mcp_server_registry_mcp_server_registry_service_all.sql
DROP POLICY IF EXISTS "message_user_feedback owner read" ON public.message_user_feedback;
\ir sql/policies/message_user_feedback_owner_read.sql
DROP POLICY IF EXISTS branding_hostname_mapping_anon_read ON public.branding_hostname_mapping;
\ir sql/policies/branding_hostname_mapping_anon_read.sql
DROP POLICY IF EXISTS "personality_signals_service_all" ON public.personality_signals;
\ir sql/policies/personality_signals_service_all.sql
DROP POLICY IF EXISTS "personality_signals_user_select" ON public.personality_signals;
\ir sql/policies/personality_signals_user_select.sql
DROP POLICY IF EXISTS "plugin_catalog_insert_admin" ON public.plugin_catalog;
\ir sql/policies/plugin_catalog_insert_admin.sql
DROP POLICY IF EXISTS "plugin_catalog_select_admin" ON public.plugin_catalog;
\ir sql/policies/plugin_catalog_select_admin.sql
DROP POLICY IF EXISTS "plugin_catalog_select_authenticated" ON public.plugin_catalog;
\ir sql/policies/plugin_catalog_select_authenticated.sql
DROP POLICY IF EXISTS "plugin_catalog_update_admin" ON public.plugin_catalog;
\ir sql/policies/plugin_catalog_update_admin.sql
DROP POLICY IF EXISTS "plugin_audit_events_insert_authenticated" ON public.plugin_audit_events;
\ir sql/policies/plugin_audit_events_insert_authenticated.sql
DROP POLICY IF EXISTS "plugin_audit_events_select_admin" ON public.plugin_audit_events;
\ir sql/policies/plugin_audit_events_select_admin.sql
DROP POLICY IF EXISTS "plugin_health_events_insert_authenticated" ON public.plugin_health_events;
\ir sql/policies/plugin_health_events_insert_authenticated.sql
DROP POLICY IF EXISTS "plugin_health_events_select_admin" ON public.plugin_health_events;
\ir sql/policies/plugin_health_events_select_admin.sql
DROP POLICY IF EXISTS "Plugin KV: admin/staff full access" ON public.plugin_kv;
\ir sql/policies/Plugin_KV_admin_staff_full_access.sql
DROP POLICY IF EXISTS "Plugin Schedules: admin/staff full access" ON public.plugin_schedules;
\ir sql/policies/Plugin_Schedules_admin_staff_full_access.sql
DROP POLICY IF EXISTS "plugin_tenant_overrides_insert_admin" ON public.plugin_tenant_overrides;
\ir sql/policies/plugin_tenant_overrides_insert_admin.sql
DROP POLICY IF EXISTS "plugin_tenant_overrides_select_own" ON public.plugin_tenant_overrides;
\ir sql/policies/plugin_tenant_overrides_select_own.sql
DROP POLICY IF EXISTS "plugin_tenant_overrides_update_admin" ON public.plugin_tenant_overrides;
\ir sql/policies/plugin_tenant_overrides_update_admin.sql
DROP POLICY IF EXISTS "plugin_transition_rules_select" ON public.plugin_transition_rules;
\ir sql/policies/plugin_transition_rules_select.sql
DROP POLICY IF EXISTS "plugin_versions_insert_admin" ON public.plugin_versions;
\ir sql/policies/plugin_versions_insert_admin.sql
DROP POLICY IF EXISTS "plugin_versions_select_authenticated" ON public.plugin_versions;
\ir sql/policies/plugin_versions_select_authenticated.sql
DROP POLICY IF EXISTS "plugin_versions_update_admin" ON public.plugin_versions;
\ir sql/policies/plugin_versions_update_admin.sql
DROP POLICY IF EXISTS "rag_eval_baselines read admin staff" ON public.rag_eval_baselines;
\ir sql/policies/rag_eval_baselines_read_admin_staff.sql
DROP POLICY IF EXISTS "signal_tag_rules_admin_all" ON public.signal_tag_rules;
\ir sql/policies/signal_tag_rules_admin_all.sql
DROP POLICY IF EXISTS "signal_tag_rules_authenticated_read" ON public.signal_tag_rules;
\ir sql/policies/signal_tag_rules_authenticated_read.sql
DROP POLICY IF EXISTS "graph_nodes admin staff read" ON public.graph_nodes;
\ir sql/policies/graph_nodes_admin_staff_read.sql
DROP POLICY IF EXISTS "graph_edges admin staff read" ON public.graph_edges;
\ir sql/policies/graph_edges_admin_staff_read.sql
DROP POLICY IF EXISTS "kmm_pages follow parent visibility" ON public.knowledge_multimodal_pages;
\ir sql/policies/kmm_pages_follow_parent_visibility.sql
DROP POLICY IF EXISTS "rag_eval_golden read admin staff" ON public.rag_eval_golden;
\ir sql/policies/rag_eval_golden_read_admin_staff.sql
DROP POLICY IF EXISTS "rag_eval_runs read admin staff" ON public.rag_eval_runs;
\ir sql/policies/rag_eval_runs_read_admin_staff.sql
DROP POLICY IF EXISTS "sla_tracking_insert_service" ON public.sla_tracking;
\ir sql/policies/sla_tracking_insert_service.sql
DROP POLICY IF EXISTS "sla_tracking_select_own" ON public.sla_tracking;
\ir sql/policies/sla_tracking_select_own.sql
DROP POLICY IF EXISTS "sla_tracking_update_service" ON public.sla_tracking;
\ir sql/policies/sla_tracking_update_service.sql
DROP POLICY IF EXISTS "Story members can view room mappings" ON public.story_matrix_rooms;
\ir sql/policies/Story_members_can_view_room_mappings.sql
DROP POLICY IF EXISTS "user_engagement_metrics_admin_all" ON public.user_engagement_metrics;
\ir sql/policies/user_engagement_metrics_admin_all.sql
DROP POLICY IF EXISTS "user_engagement_metrics_self_read" ON public.user_engagement_metrics;
\ir sql/policies/user_engagement_metrics_self_read.sql
DROP POLICY IF EXISTS "Users can view their own tracked actions" ON public.tracked_actions;
\ir sql/policies/Users_can_view_their_own_tracked_actions.sql
DROP POLICY IF EXISTS "Users can create rooms" ON public.voice_rooms;
\ir sql/policies/Users_can_create_rooms.sql
DROP POLICY IF EXISTS "Users can view rooms they participate in" ON public.voice_rooms;
\ir sql/policies/Users_can_view_rooms_they_participate_in.sql
DROP POLICY IF EXISTS "Service role only" ON public.call_events;
\ir sql/policies/Service_role_only.sql
DROP POLICY IF EXISTS "Participants can view room members" ON public.call_participants;
\ir sql/policies/Participants_can_view_room_members.sql
DROP POLICY IF EXISTS "Users can join rooms" ON public.call_participants;
\ir sql/policies/Users_can_join_rooms.sql
DROP POLICY IF EXISTS "Users can update their own status" ON public.call_participants;
\ir sql/policies/Users_can_update_their_own_status.sql
DROP POLICY IF EXISTS "Callers can create sessions" ON public.consultation_sessions;
\ir sql/policies/Callers_can_create_sessions.sql
DROP POLICY IF EXISTS "Participants can update their sessions" ON public.consultation_sessions;
\ir sql/policies/Participants_can_update_their_sessions.sql
DROP POLICY IF EXISTS "Participants can view their sessions" ON public.consultation_sessions;
\ir sql/policies/Participants_can_view_their_sessions.sql
DROP POLICY IF EXISTS "Admin and staff can read all web artifact jobs" ON public.web_artifact_jobs;
DROP POLICY IF EXISTS "Story participants can read their web artifact jobs" ON public.web_artifact_jobs;
DROP POLICY IF EXISTS "Admin and staff can insert web artifact jobs" ON public.web_artifact_jobs;
DROP POLICY IF EXISTS "Story participants can insert their web artifact jobs" ON public.web_artifact_jobs;
DROP POLICY IF EXISTS "Admin and staff can update web artifact jobs" ON public.web_artifact_jobs;
\ir sql/policies/web_artifact_jobs.sql
DROP POLICY IF EXISTS "Admin staff can read workbench requests" ON public.workbench_execution_requests;
\ir sql/policies/Admin_staff_can_read_workbench_requests.sql
DROP POLICY IF EXISTS "Service role full access workbench requests" ON public.workbench_execution_requests;
\ir sql/policies/Service_role_full_access_workbench_requests.sql

-- ── grants (GRANT is idempotent) ──
\ir sql/grants/audience_broker_sync_state.sql
\ir sql/grants/ai_run_critic_iterations.sql
\ir sql/grants/delivery_statuses.sql
\ir sql/grants/dirigent_nudges.sql
\ir sql/grants/llm_quota.sql
\ir sql/grants/message_user_feedback.sql
\ir sql/grants/personality_signals.sql
\ir sql/grants/plugin_catalog.sql
\ir sql/grants/plugin_audit_events.sql
\ir sql/grants/plugin_health_events.sql
\ir sql/grants/plugin_kv.sql
\ir sql/grants/plugin_schedules.sql
\ir sql/grants/plugin_tenant_overrides.sql
\ir sql/grants/plugin_transition_rules.sql
\ir sql/grants/plugin_versions.sql
\ir sql/grants/rag_eval_baselines.sql
\ir sql/grants/signal_tag_rules.sql
\ir sql/grants/story_goal_state.sql
\ir sql/grants/knowledge_multimodal_pages.sql
\ir sql/grants/agent_knowledge_bindings.sql
\ir sql/grants/rag_eval_golden.sql
\ir sql/grants/rag_eval_runs.sql
\ir sql/grants/sla_tracking.sql
\ir sql/grants/story_matrix_rooms.sql
\ir sql/grants/user_engagement_metrics.sql
\ir sql/grants/voice_rooms.sql
\ir sql/grants/call_events.sql
\ir sql/grants/call_participants.sql
\ir sql/grants/consultation_sessions.sql
\ir sql/grants/web_artifact_jobs.sql
\ir sql/grants/workflow_statuses.sql
\ir sql/grants/workflow_status_transitions.sql

-- ── triggers (bare CREATE TRIGGER by convention — drop-guard injected) ──
DROP TRIGGER IF EXISTS update_ai_provider_registry_updated_at ON public.ai_provider_registry;
\ir sql/triggers/update_ai_provider_registry_updated_at.sql
DROP TRIGGER IF EXISTS ai_risk_policies_updated_at ON public.ai_risk_policies;
\ir sql/triggers/ai_risk_policies_updated_at.sql
DROP TRIGGER IF EXISTS update_ai_batch_jobs_updated_at ON public.ai_batch_jobs;
\ir sql/triggers/update_ai_batch_jobs_updated_at.sql
DROP TRIGGER IF EXISTS ai_runtime_registry_updated_at ON public.ai_runtime_registry;
\ir sql/triggers/ai_runtime_registry_updated_at.sql
DROP TRIGGER IF EXISTS set_aisha_static_defense_rules_updated_at ON public.aisha_static_defense_rules;
\ir sql/triggers/set_aisha_static_defense_rules_updated_at.sql
DROP TRIGGER IF EXISTS set_aitg_automation_settings_updated_at ON public.aitg_automation_settings;
\ir sql/triggers/set_aitg_automation_settings_updated_at.sql
DROP TRIGGER IF EXISTS set_updated_at_audience_broker_sync_state ON public.audience_broker_sync_state;
\ir sql/triggers/set_updated_at_audience_broker_sync_state.sql
DROP TRIGGER IF EXISTS set_updated_at_delivery_statuses ON public.delivery_statuses;
\ir sql/triggers/set_updated_at_delivery_statuses.sql
DROP TRIGGER IF EXISTS flowboard_graphs_updated_at ON public.flowboard_graphs;
\ir sql/triggers/flowboard_graphs_updated_at.sql
DROP TRIGGER IF EXISTS trg_intranet_chat_channels_updated_at ON public.intranet_chat_channels;
\ir sql/triggers/trg_intranet_chat_channels_updated_at.sql
DROP TRIGGER IF EXISTS trg_intranet_chat_messages_updated_at ON public.intranet_chat_messages;
\ir sql/triggers/trg_intranet_chat_messages_updated_at.sql
DROP TRIGGER IF EXISTS lead_submissions_updated_at ON public.lead_submissions;
\ir sql/triggers/lead_submissions_updated_at.sql
DROP TRIGGER IF EXISTS set_llm_tier_defaults_updated_at ON public.llm_tier_defaults;
\ir sql/triggers/set_llm_tier_defaults_updated_at.sql
DROP TRIGGER IF EXISTS set_llm_quota_updated_at ON public.llm_quota;
\ir sql/triggers/set_llm_quota_updated_at.sql
DROP TRIGGER IF EXISTS update_mcp_server_registry_updated_at ON public.mcp_server_registry;
\ir sql/triggers/update_mcp_server_registry_updated_at.sql
DROP TRIGGER IF EXISTS update_openclaw_notifications_updated_at ON public.openclaw_notifications;
\ir sql/triggers/update_openclaw_notifications_updated_at.sql
DROP TRIGGER IF EXISTS update_branding_hostname_mapping_updated_at ON public.branding_hostname_mapping;
\ir sql/triggers/update_branding_hostname_mapping_updated_at.sql
DROP TRIGGER IF EXISTS trg_plugin_catalog_updated_at ON public.plugin_catalog;
\ir sql/triggers/trg_plugin_catalog_updated_at.sql
DROP TRIGGER IF EXISTS plugin_kv_updated_at ON public.plugin_kv;
\ir sql/triggers/plugin_kv_updated_at.sql
DROP TRIGGER IF EXISTS plugin_schedules_updated_at ON public.plugin_schedules;
\ir sql/triggers/plugin_schedules_updated_at.sql
DROP TRIGGER IF EXISTS trg_plugin_tenant_overrides_updated_at ON public.plugin_tenant_overrides;
\ir sql/triggers/trg_plugin_tenant_overrides_updated_at.sql
DROP TRIGGER IF EXISTS trg_signal_tag_rules_updated_at ON public.signal_tag_rules;
\ir sql/triggers/trg_signal_tag_rules_updated_at.sql
DROP TRIGGER IF EXISTS set_story_goal_state_updated_at ON public.story_goal_state;
\ir sql/triggers/set_story_goal_state_updated_at.sql
DROP TRIGGER IF EXISTS set_graph_nodes_updated_at ON public.graph_nodes;
\ir sql/triggers/set_graph_nodes_updated_at.sql
DROP TRIGGER IF EXISTS set_updated_at_agent_knowledge_bindings ON public.agent_knowledge_bindings;
\ir sql/triggers/set_updated_at_agent_knowledge_bindings.sql
DROP TRIGGER IF EXISTS trg_rag_eval_golden_updated_at ON public.rag_eval_golden;
\ir sql/triggers/trg_rag_eval_golden_updated_at.sql
DROP TRIGGER IF EXISTS sla_tracking_updated_at ON public.sla_tracking;
\ir sql/triggers/sla_tracking_updated_at.sql
DROP TRIGGER IF EXISTS set_updated_at_user_engagement_metrics ON public.user_engagement_metrics;
\ir sql/triggers/set_updated_at_user_engagement_metrics.sql
DROP TRIGGER IF EXISTS voice_rooms_updated_at ON public.voice_rooms;
\ir sql/triggers/voice_rooms_updated_at.sql
DROP TRIGGER IF EXISTS consultation_sessions_updated_at ON public.consultation_sessions;
\ir sql/triggers/consultation_sessions_updated_at.sql
DROP TRIGGER IF EXISTS workbench_execution_requests_updated_at ON public.workbench_execution_requests;
\ir sql/triggers/workbench_execution_requests_updated_at.sql
DROP TRIGGER IF EXISTS set_updated_at_workflow_statuses ON public.workflow_statuses;
\ir sql/triggers/set_updated_at_workflow_statuses.sql
DROP TRIGGER IF EXISTS set_updated_at_workflow_status_transitions ON public.workflow_status_transitions;
\ir sql/triggers/set_updated_at_workflow_status_transitions.sql

-- ── #516/#512 existing-DB reconcile (polymorphic discussion + news archive) ──────────────
-- #516 (polymorphic story_entries + entry-type registry + discussion RPCs) and #512
-- (news_articles.tags archive/blog filter) added columns to PRE-EXISTING tables, a NEW
-- table, and new RPCs — but only into the baseline (fresh cold-start). On an EXISTING DB the
-- baseline's CREATE TABLE IF NOT EXISTS is a no-op, so none of it lands; then migrate applies
-- create_story_entry_audited (INSERT names subject_id) and the entrypoint reseeds (INSERT into
-- entry_type_definitions) → both FAIL the deploy. Reconcile the deltas here, idempotently, in
-- dependency order. No-op on a fresh DB (everything already in the baseline). #497/#498 class.

-- GAP 1 — story_entries polymorphic columns. subject_id is NOT NULL with no default, so add it
-- nullable, backfill from the legacy story_id, then enforce. story_id becomes nullable (non-story
-- subjects — knowledge_topic / news_article / web_page — have no story_id).
ALTER TABLE public.story_entries ADD COLUMN IF NOT EXISTS subject_type      text NOT NULL DEFAULT 'story';
ALTER TABLE public.story_entries ADD COLUMN IF NOT EXISTS subject_id        uuid;
ALTER TABLE public.story_entries ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'visible';
ALTER TABLE public.story_entries ADD COLUMN IF NOT EXISTS moderation_reason text;
ALTER TABLE public.story_entries ALTER COLUMN story_id DROP NOT NULL;
UPDATE public.story_entries SET subject_id = story_id, subject_type = 'story'
  WHERE subject_id IS NULL AND story_id IS NOT NULL;
ALTER TABLE public.story_entries ALTER COLUMN subject_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'story_entries_status_chk' AND conrelid = 'public.story_entries'::regclass
  ) THEN
    ALTER TABLE public.story_entries
      ADD CONSTRAINT story_entries_status_chk CHECK (status IN ('visible','hidden','flagged','deleted'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_story_entries_subject ON public.story_entries (subject_type, subject_id);
DROP POLICY IF EXISTS "story_entries_public_discussion_read" ON public.story_entries;
\ir sql/policies/story_entries__public_discussion_read.sql

-- GAP 2 — entry_type_definitions (new table) + RLS policies + updated_at trigger. The core seed
-- (36_discussion_entry_types.sql, every profile) inserts into it on each deploy, so it must exist
-- before the entrypoint reseeds. Table SoT is CREATE TABLE IF NOT EXISTS + ENABLE RLS (idempotent);
-- policies are bare CREATE (inject the DROP); the trigger SoT self-guards with DROP TRIGGER IF EXISTS.
\ir sql/tables/entry_type_definitions.sql
DROP POLICY IF EXISTS "entry_type_definitions_read"    ON public.entry_type_definitions;
DROP POLICY IF EXISTS "entry_type_definitions_service" ON public.entry_type_definitions;
\ir sql/policies/entry_type_definitions__read.sql
\ir sql/triggers/entry_type_definitions_updated_at.sql

-- story_entries polymorphic subject mirror (the #517 fresh-path fix; the columns above now exist).
-- Mirror story_id -> subject_id for legacy story_id-only inserts (seed/app) and set it explicitly in
-- the canonical story RPC (replica-mode pgTAP runs with triggers OFF). No-op on a fresh DB.
\ir sql/functions/mirror_story_entries_subject.sql
DROP TRIGGER IF EXISTS story_entries_mirror_subject ON public.story_entries;
\ir sql/triggers/story_entries_mirror_subject.sql
\ir sql/functions/create_story_entry_audited.sql

-- GAP 4 — discussion read/write RPCs (depend on entry_type_definitions existing above).
\ir sql/functions/create_discussion_entry_audited.sql
\ir sql/functions/get_discussion_entries.sql
\ir sql/functions/get_entry_types.sql

-- GAP 3 — news_articles.tags (#512) + GIN index + archive/blog reader RPCs. tags has a DEFAULT so
-- the ADD COLUMN backfills; the readers are the dynamic tag-filter surface (get_news_tags /
-- get_published_news_articles_filtered) the news browser block calls.
ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
CREATE INDEX IF NOT EXISTS idx_news_articles_tags ON public.news_articles USING gin (tags);
\ir sql/functions/get_news_tags.sql
-- text_z_html() MUSÍ být PŘED listingem — ten ho volá ve WHERE. Kdyby šel po něm,
-- `CREATE OR REPLACE` listingu projde (tělo se neváže při vytvoření), ale první
-- hledání by spadlo na „function text_z_html(text) does not exist".
\ir sql/functions/text_z_html.sql
-- Listing dostal `p_locale` (abecední řazení podle titulku, ne podle klíče), takže má
-- NOVOU signaturu. `CREATE OR REPLACE` starou 5-argumentovou variantu nezruší — vyrobí
-- přetížení, a PostgREST pak volání s pojmenovanými argumenty odmítne jako nejednoznačné.
-- DROP je tu i v samotném SoT souboru; tady stojí proto, aby bylo na místě volání vidět,
-- že tenhle include starou signaturu ODSTRAŇUJE (hlídá brána heals-signature-drift).
DROP FUNCTION IF EXISTS public.get_published_news_articles_filtered(text, text[], text, integer, integer);
\ir sql/functions/get_published_news_articles_filtered.sql

-- ── feedback-plane (L0 / L0-c / L1 / T1) existing-DB reconcile ───────────────────────
-- L0 widened ai_decisions.runtime CHECK to include 'workbench' (a workbench dispatch wrote a
-- value the 6-value CHECK rejected → fn_record_execution_decision fail-closed → hard crash);
-- L0-c journals per-candidate scores + task_kind into decision_json; L1 reactively rolls real
-- outcomes into the ADVISORY ai_model_reliability sink (deliberately NOT the resolver-ranked
-- ai_model_benchmarks — telemetry must never fan out the candidate set / leak into quality ranking);
-- T1 adds the open-ended task_kind registry + normalize/observe; L2 adds the operator fleet-overview
-- read RPC and the gated improvement-proposal rollback executor (L5).
-- All of it is in the baseline (fresh DBs); reconcile the deltas onto existing DBs idempotently
-- (no-op on a fresh DB). Dependency order: registry/reliability tables → normalize/observe/writer → rollup/fleet.
ALTER TABLE public.ai_decisions DROP CONSTRAINT IF EXISTS ai_decisions_runtime_check;
ALTER TABLE public.ai_decisions ADD CONSTRAINT ai_decisions_runtime_check
  CHECK (runtime IN ('direct_llm','openclaw','hermes','workflow','human','cli','workbench'));
\ir sql/tables/ai_task_kind_registry.sql
\ir sql/tables/ai_model_reliability.sql
\ir sql/functions/normalize_task_kind.sql
\ir sql/functions/fn_observe_task_kind.sql
\ir sql/functions/record_model_reliability.sql
-- Canonical NULL-safe service-role helper — must be applied BEFORE the functions
-- that now call it (fn_get_decision_outcomes below). get_jwt_role already ships
-- in every deployed baseline; is_service_role is plpgsql (deferred resolution),
-- so the CREATE OR REPLACE is idempotent and order-robust on a running prod DB.
\ir sql/functions/is_service_role.sql
\ir sql/functions/fn_get_decision_outcomes.sql
\ir sql/functions/fn_rollup_outcomes_to_benchmark.sql
\ir sql/functions/fn_operator_fleet_overview.sql
\ir sql/functions/execute_improvement_proposal_rollback_admin.sql
-- ⭐ SCHVÁLENÍ NÁVRHU ZLEPŠENÍ HLÁSÍ PRAVDU (2026-09-28, SELF_IMPROVEMENT_LOOP.md K-05).
-- Naměřeno na main 9087ef3df: fn_create_improvement_proposal nenastaví proposal_type ani
-- proposed_value, a approve_improvement_proposal_admin(p_auto_apply) přesto prošel
-- `CASE … ELSE NULL` a zapsal status 'applied' — „aplikováno" bez jediné změny agenta
-- (totéž při neexistujícím agentovi nebo prázdném proposed_value). Nová verze: 'applied'
-- jen při skutečné změně agent_catalog, jinak 'approved' + not_applied_reason. Stojí vedle
-- rollbacku, protože ten obnovuje ze snapshotu, který zapisuje právě tahle funkce.
\ir sql/functions/approve_improvement_proposal_admin.sql

-- Enforce ai_model_benchmarks.model_registry_id -> ai_model_registry (consistency with the new
-- ai_model_reliability table; the fk-relationship-gaps lens flagged it once a sibling proved the
-- pattern). Existing-DB safe: add only when the constraint is absent AND no orphan rows exist
-- (a fresh DB already has it from the baseline → the guard no-ops).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_model_benchmarks'::regclass AND contype = 'f'
      AND conname = 'ai_model_benchmarks_model_registry_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.ai_model_benchmarks b
    LEFT JOIN public.ai_model_registry r ON r.id = b.model_registry_id
    WHERE r.id IS NULL
  ) THEN
    ALTER TABLE public.ai_model_benchmarks
      ADD CONSTRAINT ai_model_benchmarks_model_registry_id_fkey
      FOREIGN KEY (model_registry_id) REFERENCES public.ai_model_registry(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── heal #33: structural dedup — (source_slug, locale) unique on knowledge_items ──
-- The chat-delegation x17 class (#547) was possible because manual items (NULL
-- source_id) escape the guild_db-only source unique. This adds a (source_slug, locale)
-- unique so the duplication is structurally impossible for every source_type.
--
-- Existing-DB safe: collapse any pre-existing (source_slug, locale) duplicates BEFORE
-- creating the unique (else CREATE UNIQUE INDEX fails on the dups). Keep the earliest
-- row per (slug, locale); delete dependents in FK order (embeddings -> chunks -> items).
-- Idempotent — a clean DB (e.g. a fresh cold-start, where this runs on an empty table
-- before the seed) has no duplicates, so v_losers is NULL and all three DELETEs no-op.
--
-- Pre-Brick3 DBs never got the locale column itself (it ships in the baseline; no heal
-- delivered it) — the dedup + unique below reference it, so reconcile it here first,
-- verbatim from the table SoT (sql/tables/knowledge_items.sql).
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'global';
DO $$
DECLARE v_losers uuid[];
BEGIN
  SELECT array_agg(id) INTO v_losers FROM (
    SELECT id,
           row_number() OVER (PARTITION BY source_slug, locale ORDER BY created_at, id) AS rn
    FROM public.knowledge_items
    WHERE source_slug IS NOT NULL
  ) ranked WHERE rn > 1;

  IF v_losers IS NOT NULL THEN
    DELETE FROM public.knowledge_embeddings WHERE chunk_id IN (
      SELECT id FROM public.knowledge_chunks WHERE knowledge_item_id = ANY(v_losers));
    DELETE FROM public.knowledge_chunks WHERE knowledge_item_id = ANY(v_losers);
    DELETE FROM public.knowledge_items WHERE id = ANY(v_losers);
    RAISE NOTICE 'heal #33: collapsed % duplicate (source_slug, locale) knowledge_items',
                 array_length(v_losers, 1);
  END IF;
END $$;
\ir sql/indexes/idx_knowledge_items_source_slug_locale_unique.sql

-- ── heal brick5: source_concept_id (source-node identity for cross-lingual dedup) ──
-- The column + trigger + index ship in the baseline (fresh DBs), but the baseline is
-- never re-applied to existing DBs — so add the column, (re)create the trigger, backfill
-- existing rows, and create the index here. Idempotent: ADD COLUMN IF NOT EXISTS, the
-- trigger/index SoT files are DROP/CREATE-guarded, and the backfill UPDATE skips rows
-- already correct. On a fresh cold-start this runs on an empty table before the seed
-- (backfill no-ops; the seed's inserts fire the trigger).
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS source_concept_id uuid;
\ir sql/functions/set_knowledge_source_concept_id.sql
\ir sql/triggers/trg_knowledge_source_concept_id.sql
UPDATE public.knowledge_items
   SET source_concept_id = COALESCE(source_id, id)
 WHERE source_concept_id IS DISTINCT FROM COALESCE(source_id, id);
\ir sql/indexes/idx_knowledge_items_source_concept.sql

-- ── heal brick6: minimum_tier column (tier-ACL) ──
-- New nullable column (NULL = ungated), so no backfill — just add it for existing DBs
-- before mcp_search_knowledge_v2/v3 (re)compile against ki.minimum_tier.
ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS minimum_tier text;

-- ── Bricks 3–6 RAG axis: existing-DB reconcile (columns → arbiters → RPC surface) ──
-- The Brick3 locale column ships INLINE in the baseline CREATE TABLE for
-- knowledge_chunks/knowledge_embeddings (no ALTER in the table SoT, unlike
-- knowledge_items) — so no heal ever delivered it to a pre-Brick3 DB, while
-- re-applied bodies below reference it at CALL time (deferred validation:
-- mcp_search_knowledge_v3 surfaces the chunk locale, insert_knowledge_embedding_v2_audited
-- UPDATEs … AND locale = COALESCE(p_locale,'global')). heals would PASS silently
-- and the first search / v2-backfill after an upgrade aborts with 42703.
-- (knowledge_items.locale is reconciled at the heal #33 block above, where the
-- dedup EXECUTES against it — that one cannot wait for call time.)
ALTER TABLE public.knowledge_chunks     ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'global';
ALTER TABLE public.knowledge_embeddings ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'global';

-- Brick4 guild_db source-identity: widen (source_type, source_id) → +locale and
-- re-apply the mirror trigger. The OLD trigger body persists on an upgraded DB
-- (trigger bodies live in the DB; nothing re-applied them) — expert-rule edits then
-- keep mirroring into knowledge_items with the pre-locale upsert forever, silently
-- diverging from the SoT. The widened index must exist before the NEW body's
-- ON CONFLICT (source_type, source_id, locale) first fires (the seed inserts
-- expert_rules on EVERY migrate, right after heals). Data-safe: the old key was
-- unique on a subset, so the widened key holds. The index SoT file is DROP+CREATE
-- (idempotent); the trigger SoT file is a bare CREATE — drop it first.
\ir sql/indexes/idx_knowledge_items_source_unique.sql
\ir sql/functions/sync_expert_rule_to_knowledge_item.sql
DROP TRIGGER IF EXISTS trg_sync_expert_rule_to_knowledge ON public.expert_rules;
\ir sql/triggers/trg_sync_expert_rule_to_knowledge.sql

-- Widened per-locale ON CONFLICT arbiters. The re-applied v1 writers below target
-- ON CONFLICT (knowledge_item_id, chunk_index, locale) / (chunk_id, locale); a
-- pre-Brick3 DB carries only the NARROW unique shapes (as a table CONSTRAINT from
-- the old baseline, or a bare unique index) → the first ingest after an upgrade
-- aborts with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". Drop whichever narrow shape is present, then create the widened
-- index (same name/shape as the baseline). Widening is data-safe: rows unique on
-- the narrow key are unique on the wider one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'knowledge_chunks_knowledge_item_id_chunk_index_key'
      AND indexdef NOT LIKE '%locale%'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_chunks_knowledge_item_id_chunk_index_key') THEN
      ALTER TABLE public.knowledge_chunks DROP CONSTRAINT knowledge_chunks_knowledge_item_id_chunk_index_key;
    ELSE
      DROP INDEX public.knowledge_chunks_knowledge_item_id_chunk_index_key;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'knowledge_embeddings_chunk_id_key'
      AND indexdef NOT LIKE '%locale%'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_embeddings_chunk_id_key') THEN
      ALTER TABLE public.knowledge_embeddings DROP CONSTRAINT knowledge_embeddings_chunk_id_key;
    ELSE
      DROP INDEX public.knowledge_embeddings_chunk_id_key;
    END IF;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_knowledge_item_id_chunk_index_key
  ON public.knowledge_chunks USING btree (knowledge_item_id, chunk_index, locale);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_embeddings_chunk_id_key
  ON public.knowledge_embeddings USING btree (chunk_id, locale);

-- Bricks 4/5/6 RPC surface: the CURRENT service/frontend code calls these with the
-- widened named-arg sets (p_locale on the ingest writers, p_locale + p_audience_user_id
-- on v3) — a pre-brick DB has only narrower overloads → PostgREST PGRST202 (no match)
-- on the first ingest/search after an upgrade. CREATE OR REPLACE cannot change a
-- signature (it would ADD an overload and make subset-named calls ambiguous, PGRST203),
-- and the historical shapes vary with DB age — so converge generically: drop EVERY
-- overload of each name, then \ir the canonical SoT body (each file carries its own
-- REVOKE/GRANT, so grants survive the drop).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN (
         'insert_knowledge_chunk', 'insert_knowledge_embedding',
         'clear_knowledge_item_chunks', 'upsert_story_knowledge_item_audited',
         'mcp_search_knowledge_v2', 'mcp_search_knowledge_v3')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;
-- Tier helpers FIRST — the v2/v3 bodies call audience_user_meets_tier_requirement
-- (the 2-arg overload is NEW in Brick6) at run time; its SoT file also re-delivers
-- the guarded 1-arg wrapper. audience_compute_actor_tier is the single tier source
-- of truth both wrap (also new in Brick6 — absent on a pre-Brick6 DB). It is
-- LANGUAGE sql — validated at CREATE — and reads audience_actor_aggregate_latest_v,
-- a passthrough view over user_engagement_metrics (whose columns the generational
-- reconcile above re-adds): re-apply the view first so the helper compiles on a DB
-- where the view is absent or stale.
\ir sql/views/audience_actor_aggregate_latest_v.sql
-- ⛔ NAMĚŘENO 2026-09-11 (brána „Cold-start: apply“, červená i na mainu): audience_actor_tier_v
-- stojí NAD aggregate_latest_v, takže ho každé DROP … CASCADE na user_engagement_metrics shodí
-- spolu s ním — a audience_admin_twin_directory_v (dál v tomhle souboru, změněný 2026-09-05)
-- ho LEFT JOINuje. Bez téhle řádky heals na takové DB padá na
-- `relation "public.audience_actor_tier_v" does not exist` a nasazení jádra skončí bez gateway.
\ir sql/views/audience_actor_tier_v.sql
\ir sql/functions/audience_compute_actor_tier.sql
\ir sql/functions/audience_derive_actor_tier.sql
\ir sql/functions/audience_user_meets_tier_requirement.sql
\ir sql/functions/insert_knowledge_chunk.sql
\ir sql/functions/insert_knowledge_embedding.sql
\ir sql/functions/clear_knowledge_item_chunks.sql
\ir sql/functions/upsert_story_knowledge_item_audited.sql
-- v2 was NEVER re-applied here before — an upgraded DB silently kept the pre-Brick6
-- UNGATED body (minimum_tier ACL absent from the WHERE): a security-regression class,
-- not just a compile error. v3 moves up here from the former brick-1c slot so the
-- whole RAG RPC surface converges in one place, AFTER its column + helper deps.
\ir sql/functions/mcp_search_knowledge_v2.sql
\ir sql/functions/mcp_search_knowledge_v3.sql

-- ── heal PR1: ai_resolver_policy (operator-tunable resolver weights/thresholds) ──
-- The table + index + trigger + RLS ship in the baseline (fresh DBs), but the baseline is
-- never re-applied to existing DBs — so (re)create them here, then seed the always-present
-- GLOBAL default row. The resolver fails LOUD on its absence (follow-up PR), so seeding here
-- guarantees existing DBs have it on every startup, BEFORE the resolver is wired. Idempotent:
-- CREATE ... IF NOT EXISTS + DROP-guarded policies/trigger + ON CONFLICT DO NOTHING. On a fresh
-- cold-start this runs before the seed; the seed's INSERT then no-ops (row already present).
\ir sql/tables/ai_resolver_policy.sql
\ir sql/indexes/idx_ai_resolver_policy_lookup.sql
\ir sql/triggers/ai_resolver_policy_updated_at.sql
\ir sql/rls/ai_resolver_policy.sql
INSERT INTO public.ai_resolver_policy
  (scope_type, scope_id, task_kind,
   bench_weight, local_bonus, cost_match_weight, tool_match_weight, vision_match_weight,
   budget_remaining_floor, budget_max_cost, premium_max_cost,
   batch_min_deadline_hours, batch_min_tokens, health_allow_set,
   default_bench, default_expected_tokens, default_deadline_hours,
   default_max_cost, default_budget_remaining)
VALUES
  ('global', NULL, NULL, 0.55, 0.20, 0.15, 0.05, 0.05, 1.00, 0.50, 5.00,
   24, 50000, ARRAY['healthy','unknown'], 0.5, 5000, 24, 1.00, 5.00)
ON CONFLICT ON CONSTRAINT ai_resolver_policy_scope_kind_uniq DO NOTHING;

-- Re-apply the resolver (now policy-driven: reads ai_resolver_policy, fail-loud) + the operator
-- write/read RPCs so already-migrated DBs pick up the new decision logic without a baseline reset
-- (CREATE OR REPLACE; must run AFTER the table+seed above — the resolver references the ROWTYPE).
\ir sql/functions/aisha_resolve_clow_backend.sql
\ir sql/functions/set_ai_resolver_policy_audited.sql
\ir sql/functions/list_ai_resolver_policies.sql

-- ── heal PR4: ai_decision_candidates (decision lens) + resolver_policy_id on ai_decisions ──
-- New table + column for existing DBs, then re-apply the journal writer so it normalizes the
-- resolver's candidate ranking + stamps the active policy. Idempotent (IF NOT EXISTS, DROP+CREATE
-- RLS, CREATE OR REPLACE fn).
\ir sql/tables/ai_decision_candidates.sql
\ir sql/indexes/idx_ai_decision_candidates_decision.sql
ALTER TABLE public.ai_decisions ADD COLUMN IF NOT EXISTS resolver_policy_id uuid;
\ir sql/rls/ai_decision_candidates.sql
\ir sql/functions/fn_record_execution_decision.sql
-- PR5: the operator decision-observability read (decision + ranking + est-vs-actual cost).
\ir sql/functions/get_ai_decisions_admin.sql

-- ── heal: data-driven proactive dispatch engine (event-driven substrate) ──
-- Wire ai_proactive_trigger_definitions to auto-fire so the stack reacts to DB
-- events instead of polling. New functions + meta-trigger + lookup indexes reach
-- already-migrated DBs without a baseline reset. Idempotent (CREATE OR REPLACE fns
-- via \ir, CREATE INDEX IF NOT EXISTS, DROP+CREATE meta-trigger). The per-source-
-- table trg_proactive_dispatch is installed at RUNTIME by the meta-trigger when an
-- active rule row is added — nothing to heal there. Order matters: the dispatch/
-- helper fns load before the meta-trigger (which references fn_sync_proactive_trigger_installs).
\ir sql/functions/fn_proactive_condition_matches.sql
\ir sql/functions/fn_apply_proactive_dispatch_install.sql
\ir sql/functions/fn_dispatch_proactive_triggers.sql
\ir sql/functions/fn_sync_proactive_trigger_installs.sql
\ir sql/functions/fn_reconcile_proactive_dispatch_installs.sql
\ir sql/indexes/idx_ai_proactive_defs_dispatch.sql
\ir sql/indexes/idx_ai_proactive_runs_cooldown.sql
DROP TRIGGER IF EXISTS trg_proactive_defs_sync ON public.ai_proactive_trigger_definitions;
CREATE TRIGGER trg_proactive_defs_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.ai_proactive_trigger_definitions
  FOR EACH ROW EXECUTE FUNCTION fn_sync_proactive_trigger_installs();
-- Re-install dispatch triggers for any already-active rules (no-op when none exist yet).
SELECT fn_reconcile_proactive_dispatch_installs();

-- ── heal: agent_runs wake-on-event (event-driven executor wake) ──
-- Fires NOTIFY 'agent_run_queued' when a claude_cli_task becomes claimable, so
-- svc-agent-runner (via event-worker → /wake) claims immediately instead of waiting
-- for its safety-net poll. Additive + idempotent (CREATE OR REPLACE fn, DROP+CREATE trigger).
\ir sql/functions/fn_notify_queued_agent_run.sql
DROP TRIGGER IF EXISTS trg_agent_runs_notify_queued ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_notify_queued
  AFTER INSERT OR UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION fn_notify_queued_agent_run();

-- ── heal: story-sync cross-instance runtime (twin: origin story ↔ local replica) ──
-- Bundle manifest v1.1.0 (adds ai_instructions → verifiable ruleset fingerprint),
-- M2M token auth (auth.uid() may be NULL with a valid instance token), server-side
-- materialization of expert_rules/rulesets/knowledge_items on import, replica
-- bootstrap (same story UUID), stack-default adoption, and the promote flow
-- (replica → origin, promote_on_approval domains, human approve/reject).
-- Also fixes export_story_bundle referencing non-existent columns (er.content,
-- ki.slug, …) — the pre-heal function body failed at runtime.
-- Idempotent: CREATE OR REPLACE via \ir; the legacy 1-arg export overload is
-- dropped inside export_story_bundle.sql itself.
\ir sql/functions/validate_sync_authorization.sql
\ir sql/functions/export_story_bundle.sql
\ir sql/functions/import_story_bundle.sql
-- Generic federated-source governance over the story spine (audience-live-read
-- rebuild): resolve a source's endpoint/credential-ref/approval from
-- story_instances + instance_endpoint_bindings, and operator approval as a
-- classified lifecycle transition. plpgsql (deferred resolution) → order-robust;
-- deps (is_service_role, is_admin_or_staff, the tables) already in the baseline.
\ir sql/functions/audience_resolve_source_binding.sql
\ir sql/functions/audience_admin_approve_source.sql
-- Governed admin dashboards (fix N2): SECURITY DEFINER + is_admin_or_staff() gate
-- replacements for #572's direct-granted owner-rights views, which leaked PII to
-- authenticated/anon via ALTER VIEW OWNER + GRANT SELECT. Full column parity
-- (no downgrade); audience_ prefix inherits the auto-revoke + audit_grants gates.
\ir sql/functions/audience_admin_gdpr_erasure_log.sql
\ir sql/functions/audience_admin_content_reach.sql
-- ⭐ HODNOCENÍ ODPOVĚDÍ CHATU (2026-09-29, SELF_IMPROVEMENT_LOOP.md K-17). svc-ai-chat
-- evaluate.ts volal get_chat_message_by_id a get_preceding_user_message, které neměly SoT
-- (V2_PENDING v bráně rpc-sql-mapping) → každé hodnocení padlo dřív, než se soudce zeptal.
-- update_message_eval_score SoT měla, ale v heals nebyla — běžící DB ji měly jen z cold startu.
\ir sql/functions/get_chat_message_by_id.sql
\ir sql/functions/get_preceding_user_message.sql
\ir sql/functions/update_message_eval_score.sql
\ir sql/functions/audience_admin_source_onboarding.sql
\ir sql/indexes/idx_story_instances_replica_label_unique.sql
\ir sql/functions/bootstrap_story_replica.sql
\ir sql/functions/import_story_bundle_from_manifest.sql
\ir sql/functions/adopt_story_as_stack_default.sql
\ir sql/functions/seed_default_sync_policies.sql
\ir sql/functions/promote_story_bundle.sql
\ir sql/functions/approve_story_promotion.sql
\ir sql/functions/reject_story_promotion.sql

-- ── heal: anon table grants → SELECT-only least-privilege floor (#566) ──────
-- The regenerated baseline scopes every anon table grant down to SELECT, but
-- the baseline is never re-applied to an initialized DB — without this heal
-- the pg_dump-era 7-privilege anon grants (DELETE/INSERT/REFERENCES/TRIGGER/
-- TRUNCATE/UPDATE; TRUNCATE/REFERENCES/TRIGGER are not RLS-gated at all) stay
-- live on an existing prod DB indefinitely. SELECT is intentionally kept (the
-- platform's public-read model). Idempotent: REVOKE is a no-op where the
-- privilege is absent, and it cannot re-grant anything — the SEC-F4b
-- audience/cohort zero-anon posture is unaffected. Covers views too (ALL
-- TABLES includes them); no anon write path exists through RLS, so nothing
-- functional depends on the removed privileges.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon;
-- Future relations: align default privileges with the SELECT-only floor
-- (mirrors aisha/db/sql/grants/fix_missing_table_grants.sql — the heal runs as
-- the same role that installed the baseline defaults, so the bare form edits
-- the same default-privileges entry).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

-- ── heal: odysseus wave-1 governed functions (existing-DB delivery) ─────────
-- G4 eval-gated model activation (set_active_ai_model_admin: activation now
-- requires eval_status tested/approved + current benchmark >= threshold,
-- fail-closed) and the get_adaptive_model_tiers `windows` payload ship in the
-- regenerated baseline, which never re-applies to an initialized DB — these
-- \ir lines are the path by which an existing prod DB gets the new bodies.
-- Idempotent: both files are CREATE OR REPLACE with their own REVOKE/GRANT.
\ir sql/functions/set_active_ai_model_admin.sql
\ir sql/functions/get_adaptive_model_tiers.sql

-- ── heal: updated_at trigger/column parity (systemic, exposed by pgTAP 18) ──
-- Five tables carry the generic update_updated_at_column() trigger without an
-- updated_at column — every UPDATE on them failed at runtime ("record \"new\"
-- has no field \"updated_at\""), latent until the G4 eval-gate test UPDATEd
-- ai_model_benchmarks. Columns now live in the table SoT; these ALTERs deliver
-- them to existing DBs. Idempotent; NOT NULL with DEFAULT backfills instantly
-- (PG fast default). Locked by aisha/db/tests/schema/20_updated_at_trigger_column_parity.sql.
ALTER TABLE public.ai_model_benchmarks          ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;
ALTER TABLE public.delivery_transition_rules    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;
ALTER TABLE public.delivery_transitions         ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;
ALTER TABLE public.knowledge_topic_translations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;
ALTER TABLE public.knowledge_topic_versions     ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;

-- ── heal: REAL audit-ledger hash chain (Ledger Path 1, existing-DB delivery) ─
-- blockchain_audit_records carried record_hash/previous_hash since inception but
-- the chain was decorative: previous_hash was never written by ANY inserter, the
-- outbox trigger (fn_queue_blockchain_sync) wrote no hash at all, and
-- write_audit_journal salted its "blockchain_hash" with session-local now()::text
-- (unverifiable by construction). The regenerated baseline ships the real chain
-- (deterministic canonical record hash + tip-linking INSERT trigger + tamper
-- guard + fn_verify_audit_chain detector + deterministic v2 audit_journal hash);
-- these lines are the path by which an EXISTING DB gets it. All idempotent.
\ir sql/functions/fn_audit_ledger_record_hash.sql
\ir sql/functions/fn_blockchain_audit_chain_link.sql
\ir sql/functions/fn_blockchain_audit_guard.sql
\ir sql/functions/fn_verify_audit_chain.sql
\ir sql/functions/fn_verify_audit_journal_entry.sql
\ir sql/functions/write_audit_journal.sql
\ir sql/triggers/trg_blockchain_audit_chain_link.sql
\ir sql/triggers/trg_blockchain_audit_guard.sql
-- TRUNCATE guard ships in the baseline (fresh installs) but was missing from
-- this existing-DB reconcile — the convergence gate can't see it (its DB-B
-- re-applies the baseline), yet a real pre-ledger DB only runs heals and would
-- otherwise keep a TRUNCATE-able (destroyable) audit chain. Idempotent
-- (DROP TRIGGER IF EXISTS + CREATE). Same existing-DB reconcile class as the rest.
\ir sql/triggers/trg_blockchain_audit_guard_truncate.sql

-- One-time idempotent backfill: (re)build the whole chain over existing rows in
-- deterministic (created_at, id) order. Legacy rows have previous_hash NULL
-- (never written) and record_hash either NULL (outbox path) or an unchained
-- caller payload hash — the latter is preserved into data.payload_hash exactly
-- like the INSERT trigger does. No-op once every row is chained (fresh DBs and
-- every subsequent migrate). Runs under the transaction-local rebuild GUC so the
-- tamper guard admits it; serialized against live inserts by the same advisory
-- lock the INSERT trigger takes.
DO $heal_audit_ledger$
DECLARE
  r      RECORD;
  v_prev text := repeat('0', 64);
  v_data jsonb;
  v_hash text;
  v_n    bigint := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.blockchain_audit_records
    WHERE previous_hash IS NULL OR record_hash IS NULL
  ) THEN
    RETURN; -- chain already built
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.blockchain_audit_records:hash_chain', 0));
  PERFORM set_config('aisha.audit_ledger_rebuild', 'on', true);

  FOR r IN
    SELECT * FROM public.blockchain_audit_records ORDER BY created_at ASC, id ASC
  LOOP
    v_data := r.data;
    IF r.record_hash IS NOT NULL AND (v_data IS NULL OR NOT (v_data ? 'payload_hash')) THEN
      v_data := COALESCE(v_data, '{}'::jsonb) || jsonb_build_object('payload_hash', r.record_hash);
    END IF;

    v_hash := public.fn_audit_ledger_record_hash(
      v_prev, r.record_type, v_data, r.reference_table,
      r.reference_id, r.token_transaction_id, r.correlation_id, r.created_at);

    UPDATE public.blockchain_audit_records
    SET data = v_data, previous_hash = v_prev, record_hash = v_hash
    WHERE id = r.id;

    v_prev := v_hash;
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'audit ledger heal: chained % rows (head %)', v_n, v_prev;
END
$heal_audit_ledger$;

-- Chain-integrity indexes AFTER the backfill (pre-rebuild legacy data may hold
-- duplicate record_hash values; the rebuilt chain is unique by construction).
\ir sql/indexes/idx_bar_previous_hash.sql
\ir sql/indexes/idx_bar_record_hash.sql

-- Reload a running PostgREST's schema cache so the just-reconciled tables/RLS
-- are introspected without waiting for a container restart (no-op when nothing
-- is LISTENing).
NOTIFY pgrst, 'reload schema';

-- ─── webdispecink_phase1_core (folded into baseline 2026-07-03) ─────────────
-- ============================================================================
-- Webdispečink integrace — fáze 1: vozidla, řidiči, import log
-- ============================================================================
-- Reconcile pro existující DB (fresh DB má schéma z baseline). Import dat
-- z Webdispečink API přes svc-webdispecink: vozidla (_getCarsList2), řidiči
-- (_getDriversList2), log importních běhů. Entity se nemažou — jen active.
--
-- Source of truth pairs:
--   aisha/db/sql/tables/wd_vehicles.sql
--   aisha/db/sql/tables/wd_drivers.sql
--   aisha/db/sql/tables/wd_import_log.sql
--   aisha/db/sql/functions/wd_upsert_vehicles_audited.sql
--   aisha/db/sql/functions/wd_upsert_drivers_audited.sql
--   aisha/db/sql/functions/wd_record_import_audited.sql
-- ============================================================================

-- ============================================================================
-- Source of Truth: wd_vehicles
-- Popis: Vozidla importovaná z Webdispečink API (_getCarsList2).
--        Spravováno: svc-webdispecink přes wd_upsert_vehicles_audited.
--        Neaktivní vozidla se nemažou — jen active=false (zadání 3.1).
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_vehicles (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_car_id          integer      NOT NULL,
  car_group_id       integer,
  identifier         text,
  description        text,
  vehicle_type       integer,
  default_driver     text,
  active             boolean      NOT NULL DEFAULT true,
  online             boolean,
  odometer_km        numeric(12,2),
  installation_date  timestamptz,
  disable_date       timestamptz,
  raw_data           jsonb,
  last_import_at     timestamptz,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wd_vehicles_wd_car_id_key UNIQUE (wd_car_id)
);

COMMENT ON TABLE public.wd_vehicles IS 'Vozidla z Webdispečinku (SOAP _getCarsList2), upsert přes wd_upsert_vehicles_audited';
COMMENT ON COLUMN public.wd_vehicles.wd_car_id IS 'carid z Webdispečink API — externí identita vozidla';
COMMENT ON COLUMN public.wd_vehicles.identifier IS 'identifikator z API — SPZ nebo název vozidla';
COMMENT ON COLUMN public.wd_vehicles.raw_data IS 'Kompletní surová položka z API (vč. servisních polí, IMEI, jednotky)';

CREATE INDEX IF NOT EXISTS idx_wd_vehicles_active ON public.wd_vehicles (active);

ALTER TABLE public.wd_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wd_vehicles_read ON public.wd_vehicles;
CREATE POLICY wd_vehicles_read ON public.wd_vehicles
  FOR SELECT USING (public.is_admin_or_staff());

DROP POLICY IF EXISTS wd_vehicles_service ON public.wd_vehicles;
CREATE POLICY wd_vehicles_service ON public.wd_vehicles
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
-- ============================================================================
-- Source of Truth: wd_drivers
-- Popis: Řidiči importovaní z Webdispečink API (_getDriversList2).
--        Spravováno: svc-webdispecink přes wd_upsert_drivers_audited.
--        erp_employee_ref je ruční mapování na interní osobní číslo / ERP
--        zaměstnance (zadání 3.2) — import ho nikdy nepřepisuje.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_drivers (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_driver_id        integer      NOT NULL,
  first_name          text,
  last_name           text,
  personal_number     text,
  group_id            integer,
  group_name          text,
  card_identifier     text,
  phone               text,
  active              boolean      NOT NULL DEFAULT true,
  assigned_vehicle    text,
  erp_employee_ref    text,
  raw_data            jsonb,
  last_import_at      timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wd_drivers_wd_driver_id_key UNIQUE (wd_driver_id)
);

COMMENT ON TABLE public.wd_drivers IS 'Řidiči z Webdispečinku (SOAP _getDriversList2), upsert přes wd_upsert_drivers_audited';
COMMENT ON COLUMN public.wd_drivers.wd_driver_id IS 'iddriver z Webdispečink API — externí identita řidiče';
COMMENT ON COLUMN public.wd_drivers.card_identifier IS 'Dallas/RFID/karta identifikace řidiče (pole dallas z API)';
COMMENT ON COLUMN public.wd_drivers.erp_employee_ref IS 'Ruční mapování na ERP zaměstnance — import nepřepisuje';

CREATE INDEX IF NOT EXISTS idx_wd_drivers_active ON public.wd_drivers (active);
CREATE INDEX IF NOT EXISTS idx_wd_drivers_personal_number ON public.wd_drivers (personal_number);

ALTER TABLE public.wd_drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wd_drivers_read ON public.wd_drivers;
CREATE POLICY wd_drivers_read ON public.wd_drivers
  FOR SELECT USING (public.is_admin_or_staff());

DROP POLICY IF EXISTS wd_drivers_service ON public.wd_drivers;
CREATE POLICY wd_drivers_service ON public.wd_drivers
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
-- ============================================================================
-- Source of Truth: wd_import_log
-- Popis: Log importních běhů z Webdispečinku (zadání 8: veškeré importy
--        logované a opakovatelné). Řádek vzniká na startu běhu a uzavírá se
--        po dokončení/chybě přes wd_record_import_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_import_log (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type       text         NOT NULL,
  status            text         NOT NULL DEFAULT 'running',
  started_at        timestamptz  NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  records_total     integer,
  records_upserted  integer,
  records_failed    integer,
  error_message     text,
  details           jsonb,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT wd_import_log_status_check
    CHECK (status IN ('running', 'success', 'error')),
  CONSTRAINT wd_import_log_import_type_check
    CHECK (import_type IN ('vehicles', 'drivers', 'positions', 'rides', 'worklogs', 'tachograph'))
);

COMMENT ON TABLE public.wd_import_log IS 'Průběh a výsledky importních běhů svc-webdispecink';
COMMENT ON COLUMN public.wd_import_log.import_type IS 'Typ importu — fáze 1 používá vehicles/drivers, další typy rezervované pro fáze 2+';

CREATE INDEX IF NOT EXISTS idx_wd_import_log_type_started
  ON public.wd_import_log (import_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd_import_log_running
  ON public.wd_import_log (started_at)
  WHERE status = 'running';

ALTER TABLE public.wd_import_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wd_import_log_read ON public.wd_import_log;
CREATE POLICY wd_import_log_read ON public.wd_import_log
  FOR SELECT USING (public.is_admin_or_staff());

DROP POLICY IF EXISTS wd_import_log_service ON public.wd_import_log;
CREATE POLICY wd_import_log_service ON public.wd_import_log
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
-- ============================================================================
-- Source of Truth: wd_upsert_vehicles_audited
-- Popis: Batch upsert vozidel z Webdispečinku. Volá svc-webdispecink po
--        stažení _getCarsList2. Vozidla se nikdy nemažou — deaktivace přijde
--        z API přes pole active. Vrací počty inserted/updated.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_vehicles.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_vehicles_audited(
  p_vehicles jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
  v_batch jsonb;
  v_total integer;
  v_updated integer;
  v_inserted integer;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_vehicles IS NULL OR jsonb_typeof(p_vehicles) <> 'array' THEN
    RAISE EXCEPTION 'p_vehicles must be a jsonb array';
  END IF;

  -- Dedup podle wd_car_id — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_car_id')::integer) item
    FROM jsonb_array_elements(p_vehicles) AS item
    WHERE item->>'wd_car_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_vehicles v
  WHERE v.wd_car_id IN (
    SELECT (item->>'wd_car_id')::integer
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.wd_vehicles (
    wd_car_id, car_group_id, identifier, description, vehicle_type,
    default_driver, active, online, odometer_km,
    installation_date, disable_date, raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'wd_car_id')::integer,
    (item->>'car_group_id')::integer,
    item->>'identifier',
    item->>'description',
    (item->>'vehicle_type')::integer,
    item->>'default_driver',
    COALESCE((item->>'active')::boolean, true),
    (item->>'online')::boolean,
    (item->>'odometer_km')::numeric,
    NULLIF(item->>'installation_date', '')::timestamptz,
    NULLIF(item->>'disable_date', '')::timestamptz,
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_car_id) DO UPDATE SET
    car_group_id      = EXCLUDED.car_group_id,
    identifier        = EXCLUDED.identifier,
    description       = EXCLUDED.description,
    vehicle_type      = EXCLUDED.vehicle_type,
    default_driver    = EXCLUDED.default_driver,
    active            = EXCLUDED.active,
    online            = EXCLUDED.online,
    odometer_km       = EXCLUDED.odometer_km,
    installation_date = EXCLUDED.installation_date,
    disable_date      = EXCLUDED.disable_date,
    raw_data          = EXCLUDED.raw_data,
    last_import_at    = EXCLUDED.last_import_at,
    updated_at        = now();

  v_inserted := v_total - v_updated;

  -- Audit log
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'wd_vehicles.import_completed',
    jsonb_build_object(
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wd_upsert_vehicles_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_upsert_vehicles_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_upsert_vehicles_audited(jsonb) TO service_role;
-- ============================================================================
-- Source of Truth: wd_upsert_drivers_audited
-- Popis: Batch upsert řidičů z Webdispečinku. Volá svc-webdispecink po
--        stažení _getDriversList2. Řidiči se nikdy nemažou — deaktivace
--        přijde z API přes pole active. Ruční mapování erp_employee_ref
--        se importem nepřepisuje. Vrací počty inserted/updated.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_drivers.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_drivers_audited(
  p_drivers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
  v_batch jsonb;
  v_total integer;
  v_updated integer;
  v_inserted integer;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_drivers IS NULL OR jsonb_typeof(p_drivers) <> 'array' THEN
    RAISE EXCEPTION 'p_drivers must be a jsonb array';
  END IF;

  -- Dedup podle wd_driver_id — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_driver_id')::integer) item
    FROM jsonb_array_elements(p_drivers) AS item
    WHERE item->>'wd_driver_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_drivers d
  WHERE d.wd_driver_id IN (
    SELECT (item->>'wd_driver_id')::integer
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.wd_drivers (
    wd_driver_id, first_name, last_name, personal_number,
    group_id, group_name, card_identifier, phone, active,
    assigned_vehicle, raw_data, last_import_at, updated_at
  )
  SELECT
    (item->>'wd_driver_id')::integer,
    item->>'first_name',
    item->>'last_name',
    item->>'personal_number',
    (item->>'group_id')::integer,
    item->>'group_name',
    item->>'card_identifier',
    item->>'phone',
    COALESCE((item->>'active')::boolean, true),
    item->>'assigned_vehicle',
    item->'raw',
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_driver_id) DO UPDATE SET
    first_name       = EXCLUDED.first_name,
    last_name        = EXCLUDED.last_name,
    personal_number  = EXCLUDED.personal_number,
    group_id         = EXCLUDED.group_id,
    group_name       = EXCLUDED.group_name,
    card_identifier  = EXCLUDED.card_identifier,
    phone            = EXCLUDED.phone,
    active           = EXCLUDED.active,
    assigned_vehicle = EXCLUDED.assigned_vehicle,
    raw_data         = EXCLUDED.raw_data,
    last_import_at   = EXCLUDED.last_import_at,
    updated_at       = now();

  v_inserted := v_total - v_updated;

  -- Audit log (jen počty — jména a osobní čísla do auditu nepatří)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'wd_drivers.import_completed',
    jsonb_build_object(
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wd_upsert_drivers_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_upsert_drivers_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_upsert_drivers_audited(jsonb) TO service_role;
-- ============================================================================
-- Source of Truth: wd_record_import_audited
-- Popis: Životní cyklus záznamu ve wd_import_log. Volá svc-webdispecink:
--        p_action='start'  → založí běh (import_type), vrátí import_id
--        p_action='finish' → uzavře běh (status, počty, chyba)
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_import.started / wd_import.finished
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_record_import_audited(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
  v_import_id uuid;
  v_status text;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  IF p_action = 'start' THEN
    IF p_payload->>'import_type' IS NULL THEN
      RAISE EXCEPTION 'import_type required';
    END IF;

    INSERT INTO public.wd_import_log (import_type, status, started_at)
    VALUES (p_payload->>'import_type', 'running', now())
    RETURNING id INTO v_import_id;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'wd_import.started',
      jsonb_build_object(
        'import_id', v_import_id,
        'import_type', p_payload->>'import_type'
      )
    );

    RETURN jsonb_build_object('import_id', v_import_id);
  END IF;

  IF p_action = 'finish' THEN
    IF p_payload->>'import_id' IS NULL THEN
      RAISE EXCEPTION 'import_id required';
    END IF;

    v_import_id := (p_payload->>'import_id')::uuid;
    v_status := COALESCE(p_payload->>'status', 'success');
    IF v_status NOT IN ('success', 'error') THEN
      RAISE EXCEPTION 'status must be success or error';
    END IF;

    UPDATE public.wd_import_log SET
      status           = v_status,
      finished_at      = now(),
      records_total    = (p_payload->>'records_total')::integer,
      records_upserted = (p_payload->>'records_upserted')::integer,
      records_failed   = (p_payload->>'records_failed')::integer,
      error_message    = p_payload->>'error_message',
      details          = p_payload->'details'
    WHERE id = v_import_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Import run % not found', v_import_id;
    END IF;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'wd_import.finished',
      jsonb_build_object(
        'import_id', v_import_id,
        'status', v_status,
        'records_total', (p_payload->>'records_total')::integer,
        'records_upserted', (p_payload->>'records_upserted')::integer
      )
    );

    RETURN jsonb_build_object('import_id', v_import_id, 'status', v_status);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$$;

REVOKE ALL ON FUNCTION public.wd_record_import_audited(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_record_import_audited(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_record_import_audited(text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Audit (guarded — heals běží při každém migrate, insert jen jednou)
-- ---------------------------------------------------------------------------
INSERT INTO public.audit_journal (user_id, action, metadata)
SELECT
  NULL,
  'webdispecink_phase1_core.applied',
  jsonb_build_object(
    'migration', '20260703102548_webdispecink_phase1_core',
    'breaking_changes', false,
    'tables_added', ARRAY['wd_vehicles', 'wd_drivers', 'wd_import_log'],
    'rpcs_added', ARRAY[
      'wd_upsert_vehicles_audited', 'wd_upsert_drivers_audited',
      'wd_record_import_audited'
    ]
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_journal
  WHERE action = 'webdispecink_phase1_core.applied'
);

-- ---------------------------------------------------------------------------
-- updated_at triggers (SoT: aisha/db/sql/triggers/wd_*_updated_at.sql)
-- ---------------------------------------------------------------------------
-- Trigger: wd_vehicles_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_vehicles.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_vehicles_updated_at ON public.wd_vehicles;
CREATE TRIGGER wd_vehicles_updated_at
  BEFORE UPDATE ON public.wd_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger: wd_drivers_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_drivers.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_drivers_updated_at ON public.wd_drivers;
CREATE TRIGGER wd_drivers_updated_at
  BEFORE UPDATE ON public.wd_drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── webdispecink_phase2_positions_rides (folded into baseline 2026-07-03) ──
-- ============================================================================
-- Webdispečink integrace — fáze 2: polohy vozidel + kniha jízd
-- ============================================================================
-- Reconcile pro existující DB (fresh DB má schéma z baseline).
-- _getAllCarsPosition → wd_vehicle_positions_current/history (dedup, driver
-- z Dallas karty), _getCarLogBook4 → wd_rides (upsert, zpětné opravy).
--
-- Source of truth pairs:
--   aisha/db/sql/tables/wd_vehicle_positions_current.sql
--   aisha/db/sql/tables/wd_vehicle_positions_history.sql
--   aisha/db/sql/tables/wd_rides.sql
--   aisha/db/sql/triggers/wd_vehicle_positions_current_updated_at.sql
--   aisha/db/sql/triggers/wd_rides_updated_at.sql
--   aisha/db/sql/functions/wd_upsert_positions_audited.sql
--   aisha/db/sql/functions/wd_upsert_rides_audited.sql
--   aisha/db/sql/functions/wd_list_sync_vehicle_ids.sql
-- ============================================================================

-- ============================================================================
-- Source of Truth: wd_vehicle_positions_current
-- Popis: Poslední známá poloha vozidla z Webdispečinku (_getAllCarsPosition).
--        Jeden řádek na vozidlo, přepisuje se jen novější polohou.
--        Spravováno: svc-webdispecink přes wd_upsert_positions_audited.
--        wd_driver_id se dopočítává z ac_dallas ↔ wd_drivers.card_identifier.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_vehicle_positions_current (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_car_id      integer        NOT NULL,
  wd_driver_id   integer,
  driver_card    text,
  position_time  timestamptz    NOT NULL,
  latitude       numeric(10,7),
  longitude      numeric(10,7),
  speed_kmh      numeric(6,2),
  moving         boolean,
  location_text  text,
  odometer_km    numeric(12,2),
  fuel_level     numeric(8,2),
  used_fuel      numeric(10,2),
  raw_data       jsonb,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT wd_vehicle_positions_current_wd_car_id_key UNIQUE (wd_car_id)
);

COMMENT ON TABLE public.wd_vehicle_positions_current IS 'Poslední známá poloha vozidla z Webdispečinku — dispečerský přehled čte odsud, ne z historie';
COMMENT ON COLUMN public.wd_vehicle_positions_current.position_time IS 'positiontime z API; TZ sémantiku (GMT vs. lokální) potvrdit proti živému API — import je opakovatelný';
COMMENT ON COLUMN public.wd_vehicle_positions_current.driver_card IS 'ac_dallas z API — identifikace řidiče kartou/čipem v době polohy';

ALTER TABLE public.wd_vehicle_positions_current ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wd_vehicle_positions_current_read ON public.wd_vehicle_positions_current;
CREATE POLICY wd_vehicle_positions_current_read ON public.wd_vehicle_positions_current
  FOR SELECT USING (public.is_admin_or_staff());

DROP POLICY IF EXISTS wd_vehicle_positions_current_service ON public.wd_vehicle_positions_current;
CREATE POLICY wd_vehicle_positions_current_service ON public.wd_vehicle_positions_current
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
-- ============================================================================
-- Source of Truth: wd_vehicle_positions_history
-- Popis: Historie poloh vozidel z Webdispečinku — append-only, dedup přes
--        UNIQUE (wd_car_id, position_time), protože polling vrací stejnou
--        poslední polohu, dokud vozidlo stojí. Vysokoobjemová tabulka:
--        bigint identity PK (ne uuid), retence/partitioning řeší noční
--        údržba podle retenční politiky zdroje (source onboarding §5).
--        Spravováno: svc-webdispecink přes wd_upsert_positions_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_vehicle_positions_history (
  id             bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wd_car_id      integer        NOT NULL,
  wd_driver_id   integer,
  driver_card    text,
  position_time  timestamptz    NOT NULL,
  latitude       numeric(10,7),
  longitude      numeric(10,7),
  speed_kmh      numeric(6,2),
  moving         boolean,
  location_text  text,
  odometer_km    numeric(12,2),
  fuel_level     numeric(8,2),
  used_fuel      numeric(10,2),
  raw_data       jsonb,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT wd_vehicle_positions_history_car_time_key UNIQUE (wd_car_id, position_time)
);

COMMENT ON TABLE public.wd_vehicle_positions_history IS 'Historie poloh z Webdispečinku pro zpětné vyhodnocení tras; surová data v raw_data';

CREATE INDEX IF NOT EXISTS idx_wd_positions_history_car_time
  ON public.wd_vehicle_positions_history (wd_car_id, position_time DESC);
CREATE INDEX IF NOT EXISTS idx_wd_positions_history_driver_time
  ON public.wd_vehicle_positions_history (wd_driver_id, position_time DESC)
  WHERE wd_driver_id IS NOT NULL;

ALTER TABLE public.wd_vehicle_positions_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wd_vehicle_positions_history_read ON public.wd_vehicle_positions_history;
CREATE POLICY wd_vehicle_positions_history_read ON public.wd_vehicle_positions_history
  FOR SELECT USING (public.is_admin_or_staff());

DROP POLICY IF EXISTS wd_vehicle_positions_history_service ON public.wd_vehicle_positions_history;
CREATE POLICY wd_vehicle_positions_history_service ON public.wd_vehicle_positions_history
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
-- ============================================================================
-- Source of Truth: wd_rides
-- Popis: Kniha jízd z Webdispečinku (_getCarLogBook4). Upsert podle
--        wd_ride_id — kniha jízd se ve Webdispečinku zpětně opravuje,
--        opakovaný import stejného okna aktualizuje existující jízdy.
--        end_time IS NULL = rozpracovaná / nedokončená jízda.
--        Spravováno: svc-webdispecink přes wd_upsert_rides_audited.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wd_rides (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  wd_ride_id        bigint         NOT NULL,
  wd_car_id         integer        NOT NULL,
  wd_driver_id      integer,
  driver_name       text,
  start_time        timestamptz,
  end_time          timestamptz,
  start_place       text,
  end_place         text,
  purpose           text,
  ride_type         integer,
  distance_km       numeric(10,2),
  odometer_start_km numeric(12,2),
  odometer_end_km   numeric(12,2),
  driving_seconds   integer,
  standing_seconds  integer,
  max_speed_kmh     numeric(6,2),
  avg_speed_kmh     numeric(6,2),
  crew              text,
  note              text,
  raw_data          jsonb,
  last_import_at    timestamptz,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  updated_at        timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT wd_rides_wd_ride_id_key UNIQUE (wd_ride_id)
);

COMMENT ON TABLE public.wd_rides IS 'Kniha jízd z Webdispečinku (Id_jizda = wd_ride_id); zpětné opravy řeší opakovaný upsert stejného okna';
COMMENT ON COLUMN public.wd_rides.ride_type IS 'Druh z API — služební/soukromá dle číselníku Webdispečinku';
COMMENT ON COLUMN public.wd_rides.end_time IS 'NULL = rozpracovaná jízda (Dt_to prázdné v API)';

CREATE INDEX IF NOT EXISTS idx_wd_rides_car_start
  ON public.wd_rides (wd_car_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_wd_rides_driver_start
  ON public.wd_rides (wd_driver_id, start_time DESC)
  WHERE wd_driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wd_rides_in_progress
  ON public.wd_rides (wd_car_id)
  WHERE end_time IS NULL;

ALTER TABLE public.wd_rides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wd_rides_read ON public.wd_rides;
CREATE POLICY wd_rides_read ON public.wd_rides
  FOR SELECT USING (public.is_admin_or_staff());

DROP POLICY IF EXISTS wd_rides_service ON public.wd_rides;
CREATE POLICY wd_rides_service ON public.wd_rides
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Existing rows from isolated positions/rides syncs need a vehicle parent before
-- hard FK constraints can be added. Real vehicle imports later fill details.
INSERT INTO public.wd_vehicles (
  wd_car_id, raw_data, last_import_at, updated_at
)
SELECT DISTINCT
  rel.wd_car_id,
  jsonb_build_object('placeholder', true, 'source', 'webdispecink_relationship_heal'),
  now(),
  now()
FROM (
  SELECT wd_car_id FROM public.wd_vehicle_positions_current
  UNION
  SELECT wd_car_id FROM public.wd_vehicle_positions_history
  UNION
  SELECT wd_car_id FROM public.wd_rides
) rel
WHERE rel.wd_car_id IS NOT NULL
ON CONFLICT (wd_car_id) DO NOTHING;

-- Enforce Webdispecink driver relationships without breaking isolated syncs:
-- unknown driver IDs are normalized to NULL before the constraints are added.
UPDATE public.wd_vehicle_positions_current p
SET wd_driver_id = NULL
WHERE p.wd_driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.wd_drivers d WHERE d.wd_driver_id = p.wd_driver_id
  );

UPDATE public.wd_vehicle_positions_history p
SET wd_driver_id = NULL
WHERE p.wd_driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.wd_drivers d WHERE d.wd_driver_id = p.wd_driver_id
  );

UPDATE public.wd_rides r
SET wd_driver_id = NULL
WHERE r.wd_driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.wd_drivers d WHERE d.wd_driver_id = r.wd_driver_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_vehicle_positions_current_wd_driver_id_fkey'
      AND conrelid = 'public.wd_vehicle_positions_current'::regclass
  ) THEN
    ALTER TABLE public.wd_vehicle_positions_current
      ADD CONSTRAINT wd_vehicle_positions_current_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_vehicle_positions_history_wd_driver_id_fkey'
      AND conrelid = 'public.wd_vehicle_positions_history'::regclass
  ) THEN
    ALTER TABLE public.wd_vehicle_positions_history
      ADD CONSTRAINT wd_vehicle_positions_history_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_rides_wd_driver_id_fkey'
      AND conrelid = 'public.wd_rides'::regclass
  ) THEN
    ALTER TABLE public.wd_rides
      ADD CONSTRAINT wd_rides_wd_driver_id_fkey
      FOREIGN KEY (wd_driver_id)
      REFERENCES public.wd_drivers(wd_driver_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_vehicle_positions_current_wd_car_id_fkey'
      AND conrelid = 'public.wd_vehicle_positions_current'::regclass
  ) THEN
    ALTER TABLE public.wd_vehicle_positions_current
      ADD CONSTRAINT wd_vehicle_positions_current_wd_car_id_fkey
      FOREIGN KEY (wd_car_id)
      REFERENCES public.wd_vehicles(wd_car_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_vehicle_positions_history_wd_car_id_fkey'
      AND conrelid = 'public.wd_vehicle_positions_history'::regclass
  ) THEN
    ALTER TABLE public.wd_vehicle_positions_history
      ADD CONSTRAINT wd_vehicle_positions_history_wd_car_id_fkey
      FOREIGN KEY (wd_car_id)
      REFERENCES public.wd_vehicles(wd_car_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wd_rides_wd_car_id_fkey'
      AND conrelid = 'public.wd_rides'::regclass
  ) THEN
    ALTER TABLE public.wd_rides
      ADD CONSTRAINT wd_rides_wd_car_id_fkey
      FOREIGN KEY (wd_car_id)
      REFERENCES public.wd_vehicles(wd_car_id)
      ON DELETE CASCADE;
  END IF;
END $$;
-- ============================================================================
-- Source of Truth: wd_upsert_positions_audited
-- Popis: Batch zápis poloh z _getAllCarsPosition. Do historie appenduje
--        (dedup UNIQUE wd_car_id+position_time — stojící vozidlo vrací
--        stejnou polohu), poslední polohu upsertuje do current (jen novější).
--        wd_driver_id dopočítává z driver_card ↔ wd_drivers.card_identifier.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_positions.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_positions_audited(
  p_positions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
  v_batch jsonb;
  v_total integer;
  v_history_inserted integer;
  v_current_upserted integer;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_positions IS NULL OR jsonb_typeof(p_positions) <> 'array' THEN
    RAISE EXCEPTION 'p_positions must be a jsonb array';
  END IF;

  -- Dedup: poslední poloha na (wd_car_id, position_time)
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_car_id')::integer, (item->>'position_time')::timestamptz) item
    FROM jsonb_array_elements(p_positions) AS item
    WHERE item->>'wd_car_id' IS NOT NULL
      AND NULLIF(item->>'position_time', '') IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  INSERT INTO public.wd_vehicles (
    wd_car_id, raw_data, last_import_at, updated_at
  )
  SELECT DISTINCT
    (item->>'wd_car_id')::integer,
    jsonb_build_object('placeholder', true, 'source', 'wd_upsert_positions_audited'),
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_car_id) DO NOTHING;

  -- Historie: append-only, konflikt = poloha už uložená z předchozího pollu
  WITH src AS (
    SELECT
      (item->>'wd_car_id')::integer AS wd_car_id,
      NULLIF(item->>'driver_card', '') AS driver_card,
      (item->>'position_time')::timestamptz AS position_time,
      (item->>'latitude')::numeric AS latitude,
      (item->>'longitude')::numeric AS longitude,
      (item->>'speed_kmh')::numeric AS speed_kmh,
      (item->>'moving')::boolean AS moving,
      NULLIF(item->>'location_text', '') AS location_text,
      (item->>'odometer_km')::numeric AS odometer_km,
      (item->>'fuel_level')::numeric AS fuel_level,
      (item->>'used_fuel')::numeric AS used_fuel,
      item->'raw' AS raw_data
    FROM jsonb_array_elements(v_batch) AS item
  ),
  ins AS (
    INSERT INTO public.wd_vehicle_positions_history (
      wd_car_id, wd_driver_id, driver_card, position_time,
      latitude, longitude, speed_kmh, moving, location_text,
      odometer_km, fuel_level, used_fuel, raw_data
    )
    SELECT
      s.wd_car_id, d.wd_driver_id, s.driver_card, s.position_time,
      s.latitude, s.longitude, s.speed_kmh, s.moving, s.location_text,
      s.odometer_km, s.fuel_level, s.used_fuel, s.raw_data
    FROM src s
    LEFT JOIN public.wd_drivers d
      ON s.driver_card IS NOT NULL AND d.card_identifier = s.driver_card
    ON CONFLICT (wd_car_id, position_time) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_history_inserted FROM ins;

  -- Current: jeden řádek na vozidlo, přepsat jen novější polohou
  WITH src AS (
    SELECT DISTINCT ON ((item->>'wd_car_id')::integer)
      (item->>'wd_car_id')::integer AS wd_car_id,
      NULLIF(item->>'driver_card', '') AS driver_card,
      (item->>'position_time')::timestamptz AS position_time,
      (item->>'latitude')::numeric AS latitude,
      (item->>'longitude')::numeric AS longitude,
      (item->>'speed_kmh')::numeric AS speed_kmh,
      (item->>'moving')::boolean AS moving,
      NULLIF(item->>'location_text', '') AS location_text,
      (item->>'odometer_km')::numeric AS odometer_km,
      (item->>'fuel_level')::numeric AS fuel_level,
      (item->>'used_fuel')::numeric AS used_fuel,
      item->'raw' AS raw_data
    FROM jsonb_array_elements(v_batch) AS item
    ORDER BY (item->>'wd_car_id')::integer, (item->>'position_time')::timestamptz DESC
  ),
  up AS (
    INSERT INTO public.wd_vehicle_positions_current (
      wd_car_id, wd_driver_id, driver_card, position_time,
      latitude, longitude, speed_kmh, moving, location_text,
      odometer_km, fuel_level, used_fuel, raw_data, updated_at
    )
    SELECT
      s.wd_car_id, d.wd_driver_id, s.driver_card, s.position_time,
      s.latitude, s.longitude, s.speed_kmh, s.moving, s.location_text,
      s.odometer_km, s.fuel_level, s.used_fuel, s.raw_data, now()
    FROM src s
    LEFT JOIN public.wd_drivers d
      ON s.driver_card IS NOT NULL AND d.card_identifier = s.driver_card
    ON CONFLICT (wd_car_id) DO UPDATE SET
      wd_driver_id  = EXCLUDED.wd_driver_id,
      driver_card   = EXCLUDED.driver_card,
      position_time = EXCLUDED.position_time,
      latitude      = EXCLUDED.latitude,
      longitude     = EXCLUDED.longitude,
      speed_kmh     = EXCLUDED.speed_kmh,
      moving        = EXCLUDED.moving,
      location_text = EXCLUDED.location_text,
      odometer_km   = EXCLUDED.odometer_km,
      fuel_level    = EXCLUDED.fuel_level,
      used_fuel     = EXCLUDED.used_fuel,
      raw_data      = EXCLUDED.raw_data,
      updated_at    = now()
    WHERE wd_vehicle_positions_current.position_time <= EXCLUDED.position_time
    RETURNING 1
  )
  SELECT count(*) INTO v_current_upserted FROM up;

  -- Audit log (počty; polohy samotné jsou v datových tabulkách)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'wd_positions.import_completed',
    jsonb_build_object(
      'total', v_total,
      'history_inserted', v_history_inserted,
      'current_upserted', v_current_upserted
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'history_inserted', v_history_inserted,
    'current_upserted', v_current_upserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wd_upsert_positions_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_upsert_positions_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_upsert_positions_audited(jsonb) TO service_role;
-- ============================================================================
-- Source of Truth: wd_upsert_rides_audited
-- Popis: Batch upsert knihy jízd z _getCarLogBook4. Upsert podle wd_ride_id
--        — kniha jízd se zpětně opravuje, opakovaný import stejného okna
--        aktualizuje existující jízdy (vč. dokončení rozpracované jízdy).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT
-- Audit: wd_rides.import_completed s počty (bez PII)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_upsert_rides_audited(
  p_rides jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
  v_batch jsonb;
  v_total integer;
  v_updated integer;
  v_inserted integer;
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- Input validation
  IF p_rides IS NULL OR jsonb_typeof(p_rides) <> 'array' THEN
    RAISE EXCEPTION 'p_rides must be a jsonb array';
  END IF;

  -- Dedup podle wd_ride_id — ON CONFLICT nesmí zasáhnout stejný řádek dvakrát
  SELECT COALESCE(jsonb_agg(deduped.item), '[]'::jsonb) INTO v_batch
  FROM (
    SELECT DISTINCT ON ((item->>'wd_ride_id')::bigint) item
    FROM jsonb_array_elements(p_rides) AS item
    WHERE item->>'wd_ride_id' IS NOT NULL
      AND item->>'wd_car_id' IS NOT NULL
  ) AS deduped;

  v_total := jsonb_array_length(v_batch);

  SELECT count(*) INTO v_updated
  FROM public.wd_rides r
  WHERE r.wd_ride_id IN (
    SELECT (item->>'wd_ride_id')::bigint
    FROM jsonb_array_elements(v_batch) AS item
  );

  INSERT INTO public.wd_vehicles (
    wd_car_id, raw_data, last_import_at, updated_at
  )
  SELECT DISTINCT
    (item->>'wd_car_id')::integer,
    jsonb_build_object('placeholder', true, 'source', 'wd_upsert_rides_audited'),
    now(),
    now()
  FROM jsonb_array_elements(v_batch) AS item
  ON CONFLICT (wd_car_id) DO NOTHING;

  WITH src AS (
    SELECT
      (item->>'wd_ride_id')::bigint AS wd_ride_id,
      (item->>'wd_car_id')::integer AS wd_car_id,
      NULLIF(item->>'wd_driver_id', '')::integer AS raw_wd_driver_id,
      NULLIF(item->>'driver_name', '') AS driver_name,
      NULLIF(item->>'start_time', '')::timestamptz AS start_time,
      NULLIF(item->>'end_time', '')::timestamptz AS end_time,
      NULLIF(item->>'start_place', '') AS start_place,
      NULLIF(item->>'end_place', '') AS end_place,
      NULLIF(item->>'purpose', '') AS purpose,
      (item->>'ride_type')::integer AS ride_type,
      (item->>'distance_km')::numeric AS distance_km,
      (item->>'odometer_start_km')::numeric AS odometer_start_km,
      (item->>'odometer_end_km')::numeric AS odometer_end_km,
      (item->>'driving_seconds')::integer AS driving_seconds,
      (item->>'standing_seconds')::integer AS standing_seconds,
      (item->>'max_speed_kmh')::numeric AS max_speed_kmh,
      (item->>'avg_speed_kmh')::numeric AS avg_speed_kmh,
      NULLIF(item->>'crew', '') AS crew,
      NULLIF(item->>'note', '') AS note,
      item->'raw' AS raw_data
    FROM jsonb_array_elements(v_batch) AS item
  )
  INSERT INTO public.wd_rides (
    wd_ride_id, wd_car_id, wd_driver_id, driver_name,
    start_time, end_time, start_place, end_place, purpose, ride_type,
    distance_km, odometer_start_km, odometer_end_km,
    driving_seconds, standing_seconds, max_speed_kmh, avg_speed_kmh,
    crew, note, raw_data, last_import_at, updated_at
  )
  SELECT
    s.wd_ride_id,
    s.wd_car_id,
    d.wd_driver_id,
    s.driver_name,
    s.start_time,
    s.end_time,
    s.start_place,
    s.end_place,
    s.purpose,
    s.ride_type,
    s.distance_km,
    s.odometer_start_km,
    s.odometer_end_km,
    s.driving_seconds,
    s.standing_seconds,
    s.max_speed_kmh,
    s.avg_speed_kmh,
    s.crew,
    s.note,
    s.raw_data,
    now(),
    now()
  FROM src s
  LEFT JOIN public.wd_drivers d
    ON s.raw_wd_driver_id IS NOT NULL AND d.wd_driver_id = s.raw_wd_driver_id
  ON CONFLICT (wd_ride_id) DO UPDATE SET
    wd_car_id         = EXCLUDED.wd_car_id,
    wd_driver_id      = EXCLUDED.wd_driver_id,
    driver_name       = EXCLUDED.driver_name,
    start_time        = EXCLUDED.start_time,
    end_time          = EXCLUDED.end_time,
    start_place       = EXCLUDED.start_place,
    end_place         = EXCLUDED.end_place,
    purpose           = EXCLUDED.purpose,
    ride_type         = EXCLUDED.ride_type,
    distance_km       = EXCLUDED.distance_km,
    odometer_start_km = EXCLUDED.odometer_start_km,
    odometer_end_km   = EXCLUDED.odometer_end_km,
    driving_seconds   = EXCLUDED.driving_seconds,
    standing_seconds  = EXCLUDED.standing_seconds,
    max_speed_kmh     = EXCLUDED.max_speed_kmh,
    avg_speed_kmh     = EXCLUDED.avg_speed_kmh,
    crew              = EXCLUDED.crew,
    note              = EXCLUDED.note,
    raw_data          = EXCLUDED.raw_data,
    last_import_at    = EXCLUDED.last_import_at,
    updated_at        = now();

  v_inserted := v_total - v_updated;

  -- Audit log (jen počty — jména řidičů do auditu nepatří)
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'wd_rides.import_completed',
    jsonb_build_object(
      'total', v_total,
      'inserted', v_inserted,
      'updated', v_updated
    )
  );

  RETURN jsonb_build_object(
    'total', v_total,
    'inserted', v_inserted,
    'updated', v_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.wd_upsert_rides_audited(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_upsert_rides_audited(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_upsert_rides_audited(jsonb) TO service_role;
-- ============================================================================
-- Source of Truth: wd_list_sync_vehicle_ids
-- Popis: Seznam wd_car_id aktivních vozidel pro per-vozidlo sync
--        (kniha jízd _getCarLogBook4 se volá po jednom vozidle).
--        Volá svc-webdispecink před importem jízd.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT; read-only (STABLE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wd_list_sync_vehicle_ids()
RETURNS TABLE (wd_car_id integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  -- Canonical boolean-NOT-NULL service check (is_service_role.sql, #588): the
  -- prior inline claims idiom folds to SQL NULL without a role claim and the
  -- negative deny-guard below then fails OPEN. is_service_role() COALESCEs to
  -- false, so the guard is total (fails CLOSED).
  v_is_service boolean := public.is_service_role();
BEGIN
  -- Authorization check (FIRST, before any data access)
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  RETURN QUERY
  SELECT v.wd_car_id
  FROM public.wd_vehicles v
  WHERE v.active = true
  ORDER BY v.wd_car_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wd_list_sync_vehicle_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wd_list_sync_vehicle_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wd_list_sync_vehicle_ids() TO service_role;
-- Trigger: wd_vehicle_positions_current_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_vehicle_positions_current.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_vehicle_positions_current_updated_at ON public.wd_vehicle_positions_current;
CREATE TRIGGER wd_vehicle_positions_current_updated_at
  BEFORE UPDATE ON public.wd_vehicle_positions_current
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- Trigger: wd_rides_updated_at
-- Source of truth pair: aisha/db/sql/tables/wd_rides.sql
-- Keeps updated_at fresh on UPDATE. Lives in triggers/ (emitted AFTER
-- functions in the baseline) so public.set_updated_at() exists when it binds.

DROP TRIGGER IF EXISTS wd_rides_updated_at ON public.wd_rides;
CREATE TRIGGER wd_rides_updated_at
  BEFORE UPDATE ON public.wd_rides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit (guarded — heals běží při každém migrate, insert jen jednou)
-- ---------------------------------------------------------------------------
INSERT INTO public.audit_journal (user_id, action, metadata)
SELECT
  NULL,
  'webdispecink_phase2_positions_rides.applied',
  jsonb_build_object(
    'breaking_changes', false,
    'tables_added', ARRAY['wd_vehicle_positions_current', 'wd_vehicle_positions_history', 'wd_rides'],
    'rpcs_added', ARRAY['wd_upsert_positions_audited', 'wd_upsert_rides_audited', 'wd_list_sync_vehicle_ids']
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_journal
  WHERE action = 'webdispecink_phase2_positions_rides.applied'
);

-- ---------------------------------------------------------------------------
-- C2 — revoke anon read of invitations (code + intended role + email/PII).
-- The baseline fold removes the anon GRANT + the "Public can read active
-- invitations" policy from the SoT, but the generated baseline is never
-- re-applied to an existing DB and `pg_dump --no-privileges` is blind to
-- grants, so an already-initialized DB keeps the stale anon SELECT with NO
-- convergence signal. Heal it here (idempotent). Redemption is unaffected —
-- it goes through the SECURITY DEFINER validate_invitation/claim_invitation
-- RPCs, which execute as the function owner and bypass table-level grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read active invitations" ON public.invitations;
REVOKE SELECT ON public.invitations FROM anon;
-- ai_model_registry.cached_input_price_per_m backfill (odysseus G1)
-- ---------------------------------------------------------------------------
-- The prompt-cache READ rate column was exposed by get_model_pricing() but never
-- populated (upsert_discovered_model didn't carry it; the seed's ON CONFLICT DO
-- NOTHING won't touch existing rows). Backfill live/scanned rows where it is NULL,
-- from each provider's published cache-read discount vs base input (2026-07-08):
--   anthropic 0.10× · google 0.10× (2.5+) / 0.25× (2.0) · openai 0.10× (gpt-5)
--   / 0.50× (gpt-4o) / 0.25× (o-series) · xai ~0.15× · vllm 0 (self-hosted).
-- Idempotent: only fills NULLs, never overwrites a scanned/operator value. The
-- discovery scan (upsert_discovered_model, now carrying the rate) is authoritative.
UPDATE public.ai_model_registry r
SET cached_input_price_per_m = round(r.input_price_per_m * ratio.factor, 4)
FROM (
  SELECT id,
    CASE
      WHEN provider = 'anthropic' THEN 0.10
      WHEN provider = 'google' AND coalesce(model_family, '') LIKE 'gemini-2.0%' THEN 0.25
      WHEN provider = 'google' THEN 0.10
      WHEN provider = 'openai' AND coalesce(model_family, '') = 'gpt-4o' THEN 0.50
      WHEN provider = 'openai' AND (coalesce(model_family, '') IN ('o1', 'o3', 'o4') OR model_id ~ '^o[0-9]') THEN 0.25
      WHEN provider = 'openai' THEN 0.10
      WHEN provider = 'xai' THEN 0.15
      WHEN provider = 'vllm' THEN 0
      ELSE NULL
    END AS factor
  FROM public.ai_model_registry
) ratio
WHERE r.id = ratio.id
  AND ratio.factor IS NOT NULL
  AND r.cached_input_price_per_m IS NULL
  AND r.input_price_per_m IS NOT NULL;

INSERT INTO public.audit_journal (user_id, action, metadata)
SELECT
  NULL,
  'ai_model_cached_price_backfill.applied',
  jsonb_build_object(
    'breaking_changes', false,
    'column', 'ai_model_registry.cached_input_price_per_m',
    'basis', 'public provider cache-read discount vs base input (2026-07-08)'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_journal
  WHERE action = 'ai_model_cached_price_backfill.applied'
);

-- ── heal #34: ingest provenance char-spans + chunk dedup (PR-1) ──
-- knowledge_chunks gains char_start/char_end (half-open span into the source
-- document text; local-ingest kb_artifact provenance is 1:1). insert_knowledge_chunk
-- starts WRITING source_hash (column existed unused since Brick3) with
-- skip-if-unchanged upsert semantics, and get_knowledge_items_for_embedding
-- re-emits items whose chunks carry a different NON-NULL content key (legacy
-- hash-less chunks are not treated as stale → no re-embedding storm). Idempotent.
ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS char_start integer;
ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS char_end integer;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_chunks_char_span_valid'
      AND conrelid = 'public.knowledge_chunks'::regclass
  ) THEN
    ALTER TABLE public.knowledge_chunks
      ADD CONSTRAINT knowledge_chunks_char_span_valid
      CHECK (char_start IS NULL OR char_end IS NULL OR char_end >= char_start);
  END IF;
END $$;
\ir sql/functions/insert_knowledge_chunk.sql
\ir sql/functions/get_knowledge_items_for_embedding.sql

INSERT INTO public.audit_journal (user_id, action, metadata)
SELECT
  NULL,
  'ingest_provenance_dedup_heal.applied',
  jsonb_build_object(
    'breaking_changes', false,
    'columns', ARRAY['knowledge_chunks.char_start', 'knowledge_chunks.char_end'],
    'functions', ARRAY['insert_knowledge_chunk (10-arg)', 'get_knowledge_items_for_embedding (stale-hash gate)']
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_journal
  WHERE action = 'ingest_provenance_dedup_heal.applied'
);

-- ── heal #35: evidence registry SoT (E3/E5) ──
-- Materializes the phantom agent_knowledge_sources + the evidence registry
-- (document_registry, contract_register, obligation_register) with default-deny
-- RLS (admin-only read), service-role-only audited write RPCs, and updated_at
-- triggers. All idempotent (CREATE TABLE IF NOT EXISTS / DROP-CREATE policies).
\ir sql/tables/agent_knowledge_sources.sql
\ir sql/tables/document_registry.sql
\ir sql/tables/contract_register.sql
\ir sql/tables/obligation_register.sql
\ir sql/rls/agent_knowledge_sources.sql
\ir sql/rls/document_registry.sql
\ir sql/rls/contract_register.sql
\ir sql/rls/obligation_register.sql
\ir sql/policies/agent_knowledge_sources_admin_select.sql
\ir sql/policies/agent_knowledge_sources_service_all.sql
\ir sql/policies/document_registry_admin_select.sql
\ir sql/policies/document_registry_service_all.sql
\ir sql/policies/contract_register_admin_select.sql
\ir sql/policies/contract_register_service_all.sql
\ir sql/policies/obligation_register_admin_select.sql
\ir sql/policies/obligation_register_service_all.sql
\ir sql/triggers/agent_knowledge_sources_updated_at.sql
\ir sql/triggers/document_registry_updated_at.sql
\ir sql/triggers/contract_register_updated_at.sql
\ir sql/triggers/obligation_register_updated_at.sql
\ir sql/functions/register_source_document_audited.sql
-- ⭐ ZPĚTNÁ VAZBA → TRÉNOVACÍ PÁRY (2026-09-28, SELF_IMPROVEMENT_LOOP.md K-02). Naměřeno na
-- main 9087ef3df: process_feedback_to_training dávala `input = NULL` do sloupce NOT NULL
-- a DPO řádku nevyplnila `output` → první vhodná zpětná vazba shodila celou dávku a každý
-- další běh padl znovu; z opravy uživatele nikdy nevznikl pár. Funkce v heals nebyla.
-- Příklady dál vznikají NEVALIDOVANÉ (export bere jen validované) — žádný syrový obsah
-- konverzace se touhle opravou do tréninku nedostane.
\ir sql/functions/process_feedback_to_training.sql
\ir sql/functions/upsert_contract_extract_audited.sql
\ir sql/grants/evidence_registry.sql

INSERT INTO public.audit_journal (user_id, action, metadata)
SELECT
  NULL,
  'evidence_registry_heal.applied',
  jsonb_build_object(
    'breaking_changes', false,
    'tables', ARRAY['agent_knowledge_sources','document_registry','contract_register','obligation_register'],
    'functions', ARRAY['register_source_document_audited','upsert_contract_extract_audited']
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_journal
  WHERE action = 'evidence_registry_heal.applied'
);

-- ── heal #36: ACS core (Agent Communication Standard, F0–F5) ──
-- Materializes the ACS DB chokepoint folded out of the former 20260708* delta
-- migrations (#678 rework → baseline SoT). The baseline is never re-applied on a
-- no-wipe upgrade, so — like heal #35 — the new objects must be reconciled here.
-- Idempotent: tables CREATE IF NOT EXISTS (inline RLS), trigger fns + RPCs
-- CREATE OR REPLACE, triggers/policies DROP-CREATE, grants REVOKE/GRANT.
-- Dependency order: intents/schemas → message_log/pending_effects/agent_acl (FKs),
-- trigger functions before their triggers.
\ir sql/tables/acs_intents.sql
\ir sql/tables/acs_message_schemas.sql
\ir sql/tables/acs_message_log.sql
\ir sql/tables/acs_dead_letters.sql
\ir sql/tables/acs_pending_effects.sql
\ir sql/tables/acs_agent_acl.sql
\ir sql/functions/acs_intents_block_mutation.sql
\ir sql/functions/acs_message_log_block_mutation.sql
\ir sql/functions/acs_message_log_notify.sql
\ir sql/triggers/trg_acs_intents_immutable.sql
\ir sql/triggers/trg_acs_message_log_append_only.sql
\ir sql/triggers/trg_acs_message_log_notify.sql
\ir sql/triggers/acs_message_schemas_updated_at.sql
\ir sql/indexes/idx_acs_message_log_correlation.sql
\ir sql/indexes/idx_acs_message_log_intent.sql
\ir sql/indexes/idx_acs_message_log_logged_at.sql
\ir sql/indexes/idx_acs_dead_letters_created.sql
\ir sql/indexes/idx_acs_pending_effects_state.sql
\ir sql/rls/acs_intents.sql
\ir sql/rls/acs_message_schemas.sql
\ir sql/rls/acs_message_log.sql
\ir sql/rls/acs_dead_letters.sql
\ir sql/rls/acs_pending_effects.sql
\ir sql/rls/acs_agent_acl.sql
\ir sql/policies/acs_intents_admin_select.sql
\ir sql/policies/acs_intents_service_all.sql
\ir sql/policies/acs_message_schemas_admin_select.sql
\ir sql/policies/acs_message_schemas_service_all.sql
\ir sql/policies/acs_message_log_admin_select.sql
\ir sql/policies/acs_message_log_service_all.sql
\ir sql/policies/acs_dead_letters_admin_select.sql
\ir sql/policies/acs_dead_letters_service_all.sql
\ir sql/policies/acs_pending_effects_admin_select.sql
\ir sql/policies/acs_pending_effects_service_all.sql
\ir sql/policies/acs_agent_acl_admin_select.sql
\ir sql/policies/acs_agent_acl_service_all.sql
\ir sql/functions/acs_create_intent.sql
\ir sql/functions/acs_ingest_message.sql
\ir sql/functions/acs_check_acl.sql
\ir sql/functions/acs_effect_propose.sql
\ir sql/functions/acs_effect_decide.sql
\ir sql/functions/acs_effect_mark_executed.sql
\ir sql/grants/acs.sql

INSERT INTO public.audit_journal (user_id, action, metadata)
SELECT
  NULL,
  'acs_core_heal.applied',
  jsonb_build_object(
    'breaking_changes', false,
    'mode', 'off',
    'tables', ARRAY['acs_intents','acs_message_schemas','acs_message_log','acs_dead_letters','acs_pending_effects','acs_agent_acl']
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_journal
  WHERE action = 'acs_core_heal.applied'
);


-- ── heal #37: 2026-07-15 IDOR remediation reaches EXISTING DBs ──────────────
-- WHY: PR #733 fixed 13 SECURITY DEFINER functions in aisha/db/sql/ and regenerated the
-- baseline. The baseline is NEVER re-applied to an already-initialized DB (this file's
-- header; scripts/db/migrate.mjs:468) and delta migrations are forbidden by the
-- baseline-only invariant. So merging #733 fixed `main` and changed NOTHING in prod: the
-- live token mint (GRANT EXECUTE ON award_tokens TO authenticated, zero authz — any
-- logged-in user could mint unlimited governance tokens) stayed open, and a redeploy
-- would have reported success while leaving it open. Merged != deployed != fixed.
--
-- ►► THE NON-OBVIOUS PART — why the function bodies below are NOT enough. ◄◄
-- Each SoT file ends with `REVOKE ALL ON FUNCTION ... FROM PUBLIC` + a GRANT to the
-- roles that should keep it. On a FRESH DB that is sufficient: the baseline never
-- grants `authenticated`, so there is nothing to take away. On an EXISTING DB the OLD
-- baseline's explicit `GRANT EXECUTE ... TO authenticated` is still on the object, and
-- REVOKE ... FROM PUBLIC does NOT touch an explicit role grant. Verified by executing
-- it: applying only the bodies below against a DB built from the pre-fix baseline left
-- has_function_privilege('authenticated','award_tokens',...) = TRUE and the mint
-- callable. The explicit REVOKEs at the end of this block are what actually close it.
-- This is the exact inverse of trap #1 in the audit doc, and it is why this heal is
-- proven against a simulated existing DB rather than reasoned about.
--
-- Dependency order is load-bearing: get_jwt_role -> is_service_role -> everything else.
-- is_service_role() appears nowhere else in this file, so a DB created before it was
-- folded into the baseline does not have it and every guard below would fail on a
-- missing function.
--
-- Idempotent by construction: CREATE OR REPLACE FUNCTION + REVOKE/GRANT only. No
-- tables, columns or constraints. No-op on a fresh DB (identical bodies, and the
-- REVOKEs remove grants that are not there).
--
-- NOTE fn_check_and_consume_* KEEP their `authenticated` grant on purpose (WP 2.3 gates
-- an end user on their own quota, per JWT.sub — asserted by wp-2-3-llm-quota.gate.test.ts
-- and ai-budget.gate.test.ts). Their fix is the p_user_id pin in the body, not a revoke.
--
-- See docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md.

-- ── get_jwt_role — canonical JWT role reader
-- Function: get_jwt_role
-- Returns the JWT role claim from the current request context.
-- Compatible with both PostgREST <12 (request.jwt.claim.role)
-- and PostgREST 14+ (request.jwt.claims JSON object).

CREATE OR REPLACE FUNCTION public.get_jwt_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claim.role', true),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
  );
$$;

REVOKE ALL ON FUNCTION get_jwt_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_jwt_role() TO anon, authenticated, service_role;

-- ── is_service_role — NULL-safe service_role detector — every guard below calls it
-- Function: public.is_service_role
-- Description: The single canonical answer to "is the current request the
--   trusted service_role?" — boolean-NOT-NULL by construction.
--
--   Replaces the inline idiom
--     (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role'
--   which folds to SQL NULL when the `role` claim is absent (anon / a token with
--   no role), and a NULL then propagates through negative deny-guards
--   (`IF v_user_id IS NULL AND NOT v_is_service` / `IF NOT v_is_service AND ...`)
--   so `IF NULL` never RAISEs → the guard FAILS OPEN. Both disjuncts here
--   COALESCE to false, so the result is never NULL and any deny-guard built on
--   `NOT is_service_role()` is total (fails CLOSED).
--
--   Reuses get_jwt_role() as the single reader of request.jwt.claims (keeps the
--   legacy-GUC / JSON-claims compatibility in one place) and keeps the SET ROLE
--   GUC disjunct so an in-DB `SET ROLE service_role` caller is still recognised.
--
--   LANGUAGE plpgsql (not sql) so the body is not name-resolved at CREATE time —
--   this makes it ordering-immune on both the cold-start baseline and heals
--   (no dependency-ordering hazard vs get_jwt_role).
-- Security: SECURITY DEFINER, search_path pinned. Safe in RLS policies and
--   SECURITY DEFINER RPCs. Granted to anon too (returns false) so anon-granted
--   callers can adopt it without a permission-denied.

CREATE OR REPLACE FUNCTION public.is_service_role()
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  RETURN COALESCE(public.get_jwt_role() = 'service_role', false)
      OR COALESCE(current_setting('role', true) = 'service_role', false);
END;
$$;

REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_service_role() IS
  'Boolean-NOT-NULL service_role detector. Canonical replacement for the inline '
  'request.jwt.claims->>''role''=''service_role'' idiom that folds to NULL (and '
  'fails OPEN in negative deny-guards) when the role claim is absent. Reuses '
  'get_jwt_role(); keeps the SET ROLE GUC disjunct. plpgsql = ordering-immune.';

-- ── award_tokens — THE live mint
-- Function: public.award_tokens
-- Arguments: p_user_id uuid, p_token_type text, p_amount integer, p_reference_type text, p_reference_id uuid, p_description text
-- Description: Mints tokens onto a membership's ledger. PRIVILEGED PRIMITIVE — the CALLER is
--   trusted to have authorized the award; this function does NOT authorize it. Reachable only
--   by service_role and by in-DB SECURITY DEFINER callers. NOT callable from the browser.
-- Security: the GRANT is the authorization boundary, deliberately — there is no JWT guard here.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): this function was
--   GRANTed to `authenticated` with ZERO authorization logic, so any logged-in user could
--   POST /rest/v1/rpc/award_tokens {p_user_id:<self>, p_token_type:'governance', p_amount:1e8}
--   and mint unlimited voting weight; a NEGATIVE p_amount against a victim's uuid drained their
--   balance and forged a 'reward' row in their ledger. The only "guard" was
--   useAdminGuard.guardAdminMutation — CLIENT-side React, which enforces nothing in the DB.
--   Self-award IS the exploit, so a `p_user_id <> auth.uid()` guard cannot fix it: the CALLER
--   must be restricted instead — hence REVOKE, not a predicate.
--
--   WHY NO is_service_role()/is_admin_or_staff() GUARD HERE: SECURITY DEFINER swaps current_user,
--   NOT the JWT claims, so such a guard would still read the ORIGINAL caller's claims and would
--   reject the legitimate in-DB awarders that mint for an ordinary user — log_health_state_audited,
--   confirm_product_taken_audited and submit_health_document_analysis_audited all award auth.uid()
--   after verifying ownership. Those callers run as the OWNER, who keeps EXECUTE by virtue of
--   ownership (REVOKE ... FROM PUBLIC does not touch it), and each authorizes its own recipient:
--     - award_leaderboard_rewards      → is_admin_or_staff(), recipient from period data
--     - log_health_state_audited       → recipient = auth.uid(), ownership-verified
--     - confirm_product_taken_audited  → recipient = auth.uid(), ownership-verified
--     - submit_health_document_analysis_audited → recipient = auth.uid(), access-verified
--     - process_token_reward           → p_user_id = auth.uid() unless service_role/admin
--   ANY NEW CALLER MUST DO THE SAME. Re-granting this function to `authenticated`/`anon` reopens
--   the hole; idor-prevention.gate.test.ts fails the build if that happens.
-- @audit: none (the ledger row in token_transactions is the record; the caller is trusted)

CREATE OR REPLACE FUNCTION public.award_tokens(p_user_id uuid, p_token_type text, p_amount integer, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_membership_id uuid;
  v_current_balance integer := 0;
  v_new_balance integer;
  v_transaction_id uuid;
BEGIN
  -- Positive amounts only. `v_new_balance := v_current_balance + p_amount` below means a
  -- negative amount is a BALANCE DRAIN that also forges a 'reward' ledger row — a distinct
  -- bug from the missing authorization, closed here. Use a debit RPC to spend tokens.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING MESSAGE = format('award_tokens amount must be positive, got: %s', p_amount), ERRCODE = '22023';
  END IF;

  -- Validate token type
  IF p_token_type NOT IN ('governance', 'impact', 'data', 'aisha') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid token type: %s', p_token_type), ERRCODE = '22023';
  END IF;

  -- Get user's membership and current balance
  SELECT id,
    CASE p_token_type
      WHEN 'governance' THEN COALESCE(tokens_governance, 0)
      WHEN 'impact' THEN COALESCE(tokens_impact, 0)
      WHEN 'data' THEN COALESCE(tokens_data, 0)
      WHEN 'aisha' THEN COALESCE(tokens_aisha, 0)
    END
  INTO v_membership_id, v_current_balance
  FROM memberships
  WHERE user_id = p_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Create membership if it doesn't exist
  IF v_membership_id IS NULL THEN
    INSERT INTO memberships (user_id, tier, status, payment_type)
    VALUES (p_user_id, 'basic', 'active', 'one_time')
    RETURNING id INTO v_membership_id;
    v_current_balance := 0;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + p_amount;

  -- Update membership balance
  IF p_token_type = 'governance' THEN
    UPDATE memberships SET tokens_governance = v_new_balance WHERE id = v_membership_id;
  ELSIF p_token_type = 'impact' THEN
    UPDATE memberships SET tokens_impact = v_new_balance WHERE id = v_membership_id;
  ELSIF p_token_type = 'data' THEN
    UPDATE memberships SET tokens_data = v_new_balance WHERE id = v_membership_id;
  ELSIF p_token_type = 'aisha' THEN
    UPDATE memberships SET tokens_aisha = v_new_balance WHERE id = v_membership_id;
  END IF;

  -- Record transaction
  INSERT INTO token_transactions (
    user_id,
    token_type,
    transaction_type,
    amount,
    balance_after,
    reference_type,
    reference_id,
    description
  ) VALUES (
    p_user_id,
    p_token_type,
    'reward',
    p_amount,
    v_new_balance,
    p_reference_type,
    p_reference_id,
    p_description
  ) RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'previous_balance', v_current_balance,
    'new_balance', v_new_balance,
    'amount_awarded', p_amount
  );
END;
$function$
;

-- Permissions
-- service_role ONLY. The `authenticated` grant was the IDOR: PostgREST exposes every public
-- function, the gateway /rest/v1/* is a blanket proxy with no RPC allowlist, and
-- buildPostgrestClaims() hands every valid Keycloak token role=authenticated — so the grant
-- alone made this reachable by any logged-in user. Admin token-award goes through
-- award_tokens_admin_audited (which checks is_admin_or_staff IN THE DB, not in React).
REVOKE ALL ON FUNCTION public.award_tokens(p_user_id uuid, p_token_type text, p_amount integer, p_reference_type text, p_reference_id uuid, p_description text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_tokens(p_user_id uuid, p_token_type text, p_amount integer, p_reference_type text, p_reference_id uuid, p_description text) TO service_role;

-- ── award_tokens_admin_audited — new admin door
-- Function: public.award_tokens_admin_audited
-- Arguments: p_amount integer, p_description text, p_reference_id uuid, p_reference_type text, p_token_type text, p_user_id uuid
-- Description: Admin path for granting tokens. Companion to award_tokens, which became
--   service_role-only in the 2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md).
--
--   WHY A WRAPPER INSTEAD OF GRANTING award_tokens: the admin UI (src/hooks/useTokens.ts) calls
--   the RPC with a user JWT (role=authenticated). Its only protection used to be
--   useAdminGuard.guardAdminMutation — CLIENT-side React, which enforces nothing in the database,
--   so any logged-in user could POST /rest/v1/rpc/award_tokens directly and mint themselves
--   unlimited governance tokens. Here the admin check is enforced IN THE DATABASE: the grant lets
--   an admin's JWT reach the function, is_admin_or_staff() decides whether it proceeds.
--
-- Security: SECURITY DEFINER; is_admin_or_staff() fail-closed as the FIRST statement. That guard is
--   the ONLY authorization on this path — award_tokens itself performs none (its GRANT is its
--   boundary), and we reach it only because SECURITY DEFINER runs us as the owner, who holds
--   EXECUTE by ownership. Do not remove the guard without replacing it.
-- Params: alphabetical (generated TS types are ordered alphabetically — see
--   src/tests/db/rpc-params-alphabetical.test.ts). PostgreSQL requires defaults to trail, so the
--   required p_token_type/p_user_id carry defaults and are NULL-checked in the body instead.
-- @audit: token.admin_awarded — an admin touching someone else's ledger MUST leave a trace; the
--   token_transactions row alone is not one, since the admin authored it.

CREATE OR REPLACE FUNCTION public.award_tokens_admin_audited(
  p_amount         integer,
  p_description    text DEFAULT NULL::text,
  p_reference_id   uuid DEFAULT NULL::uuid,
  p_reference_type text DEFAULT NULL::text,
  p_token_type     text DEFAULT NULL::text,
  p_user_id        uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- AUTHORIZATION FIRST — before the audit row and before any ledger touch.
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff required' USING ERRCODE = '42501';
  END IF;

  -- Required despite carrying defaults (see Params note above) — fail loud, do not coalesce.
  IF p_user_id IS NULL OR p_token_type IS NULL THEN
    RAISE EXCEPTION 'p_user_id and p_token_type are required' USING ERRCODE = '22023';
  END IF;

  -- award_tokens validates the amount and token type and does the minting.
  v_result := public.award_tokens(
    p_user_id, p_token_type, p_amount, p_reference_type, p_reference_id, p_description
  );

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area        := 'tokens'::journal_area,
    p_details     := jsonb_build_object(
      'target_user_id', p_user_id,
      'token_type', p_token_type,
      'amount', p_amount,
      'reference_type', p_reference_type,
      'reference_id', p_reference_id,
      'description', p_description
    ),
    p_entity_id   := p_user_id::text,
    p_entity_type := 'token_transaction',
    p_severity    := 'warning'::journal_severity,
    p_summary     := format('Admin awarded %s %s tokens', p_amount, p_token_type),
    p_tags        := ARRAY['tokens', 'admin', 'ledger'],
    p_user_id     := auth.uid()
  );

  RETURN v_result;
END;
$function$
;

-- Permissions
-- The GRANT lets an admin's browser JWT reach the function; is_admin_or_staff() above decides
-- whether it proceeds. A non-admin authenticated caller gets 42501.
REVOKE ALL ON FUNCTION public.award_tokens_admin_audited(p_amount integer, p_description text, p_reference_id uuid, p_reference_type text, p_token_type text, p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_tokens_admin_audited(p_amount integer, p_description text, p_reference_id uuid, p_reference_type text, p_token_type text, p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.award_tokens_admin_audited(p_amount integer, p_description text, p_reference_id uuid, p_reference_type text, p_token_type text, p_user_id uuid) TO service_role;

-- ── process_token_reward — pin p_user_id to auth.uid()
-- Function: public.process_token_reward
-- Arguments: p_user_id uuid, p_action_type text, p_reference_id uuid
-- Description: Awards the configured token_reward_rules payout for an action the CALLER performed.
--   Self-service by design (useProcessReward passes the session user's own id), so p_user_id is
--   pinned to auth.uid() rather than revoked.
-- Security: SECURITY DEFINER with search_path + auth.uid() ownership guard.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): granted to
--   `authenticated` and accepted ANY p_user_id with no authorization, so a logged-in user could
--   POST /rest/v1/rpc/process_token_reward with a victim's uuid and burn their once-per-action
--   reward eligibility (can_receive_reward cooldown) — the victim then permanently loses a payout
--   they never received. This is the mirror image of award_tokens: here the caller legitimately
--   awards THEMSELVES, so pinning p_user_id to auth.uid() is the correct fix and the grant stays.
-- KNOWN CRITICAL GAP — unlimited self-mint, NOT closed by the fix above (tracked, fix in flight):
--   p_action_type/p_reference_id are never verified against a real action. A user may claim a
--   reward for something they never did — and, contrary to a first reading, this is NOT bounded:
--   every limit in can_receive_reward is `IF v_rule.<limit> IS NOT NULL THEN ... END IF`, so a rule
--   with cooldown_hours/daily_limit/weekly_limit/monthly_limit all NULL skips EVERY check and
--   returns can_receive=true unconditionally. 8 of the 12 seeded rules are exactly that shape,
--   including study_completion at 100 tokens and placebo_compensation at 50 — repeatable in a loop.
--   The ONLY reason this is not exploitable today is an accident: all 12 seeded rules carry
--   token_type='PLATFORM' (aisha/db/seed/core/06_subscriptions.sql), and award_tokens raises on
--   any token_type outside ('governance','impact','data','aisha'). The reward feature is therefore
--   DEAD, and its deadness is the security control. DO NOT "fix" the token_type without landing the
--   evidence contract first — that single edit silently arms an unlimited mint.
--   The pin above is still necessary and orthogonal: it stops a user burning a VICTIM's eligibility.
--   Fixing the mint needs a per-action evidence contract (see the audit doc).
-- @audit: none (token operations logged in token_transactions table)

CREATE OR REPLACE FUNCTION public.process_token_reward(p_user_id uuid, p_action_type text, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule record;
  v_can_receive jsonb;
  v_amount integer;
  v_result jsonb;
BEGIN
  -- AUTHORIZATION FIRST — before any rule read or ledger write. A user may only process their
  -- OWN rewards; service_role (trusted backend) and admin/staff may act for anyone.
  -- is_service_role() is the NULL-safe reader — the inline request.jwt.claims idiom folds to
  -- NULL when the role claim is absent and would make this deny-guard fail OPEN.
  -- `auth.uid() IS NULL` is part of the deny condition on purpose: without it a NULL uid and a
  -- NULL p_user_id are NOT DISTINCT, so an unauthenticated caller would slip through the guard.
  IF NOT public.is_service_role()
     AND NOT public.is_admin_or_staff()
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid())
  THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Get all active rules for this action type
  FOR v_rule IN
    SELECT
      token_type,
      base_amount,
      multiplier,
      min_amount,
      max_amount,
      action_name_key,
      action_type
    FROM token_reward_rules
    WHERE action_type = p_action_type AND is_active = true
  LOOP
    -- Check if user can receive this reward
    v_can_receive := can_receive_reward(p_user_id, p_action_type, v_rule.token_type);
    
    IF (v_can_receive->>'can_receive')::boolean THEN
      -- Calculate amount
      v_amount := FLOOR(v_rule.base_amount * v_rule.multiplier);
      
      -- Apply min/max constraints
      IF v_rule.min_amount IS NOT NULL AND v_amount < v_rule.min_amount THEN
        v_amount := v_rule.min_amount;
      END IF;
      IF v_rule.max_amount IS NOT NULL AND v_amount > v_rule.max_amount THEN
        v_amount := v_rule.max_amount;
      END IF;
      
      -- Award the tokens
      v_result := award_tokens(
        p_user_id,
        v_rule.token_type,
        v_amount,
        p_action_type,
        p_reference_id,
        COALESCE(
          public.get_translation_value_with_fallback(v_rule.action_name_key, 'rewards', 'en', 'en', NULL),
          v_rule.action_type
        )
      );
    END IF;
  END LOOP;

  RETURN COALESCE(v_result, jsonb_build_object('success', false, 'reason', 'No rewards processed'));
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.process_token_reward(p_user_id uuid, p_action_type text, p_reference_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_token_reward(p_user_id uuid, p_action_type text, p_reference_id uuid) TO authenticated;

-- ── write_audit_journal — audit-attribution forgery
-- Function: public.write_audit_journal
-- Arguments: p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_severity journal_severity, p_summary text, p_tags text[], p_user_id uuid
-- Description: Unified audit journal writer with alphabetically ordered parameters.
--   blockchain_hash (v2): deterministic SHA-256 over the STORED row columns only
--   (action, entity_type, entity_id, created_at epoch, new_data, metadata minus the hash
--   itself) — no now()::text salt, no unstored inputs — so fn_verify_audit_journal_entry
--   can recompute and verify it. Written to the blockchain_hash COLUMN (what
--   get_audit_journal returns) and mirrored into metadata for backward compatibility.
--   user_id is deliberately excluded (FK ON DELETE SET NULL mutates it on user erasure).
-- Security: SECURITY DEFINER with search_path set. PRIVILEGED PRIMITIVE — the caller chooses the
--   actor via p_user_id, so the caller must already be trusted. Reachable only by service_role and
--   by the ~358 in-DB SECURITY DEFINER callers (which run as the OWNER and therefore need no
--   grant). NOT callable with a user JWT — browsers use write_my_audit_journal_entry, which has no
--   p_user_id and pins the actor to auth.uid().
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): the `authenticated`
--   grant let ANY logged-in user author an audit entry attributed to someone else — evidence
--   fabrication in the tamper-evident ledger, and the forged row received a VALID blockchain_hash,
--   so fn_verify_audit_chain attested it as authentic (the hash proves the row was not altered
--   after insertion; it says nothing about who authored it). A guard cannot fix this: the in-DB
--   callers legitimately pass a p_user_id that is not auth.uid() (system entries pass NULL), and a
--   JWT-reading guard cannot tell them apart from a direct PostgREST call, since SECURITY DEFINER
--   swaps current_user but not the JWT claims. Restricting the CALLER is the fix.
--   n8n (AishaAudit, AishaNodeFactory) authenticates with serviceRoleKey and is unaffected.
-- Updated: 2026-07-15 (revoked from `authenticated`; was audit-attribution forgery)
-- Updated: 2026-07-03 (deterministic v2 hash; was salted with session-local now()::text)

CREATE OR REPLACE FUNCTION public.write_audit_journal(
  p_action_type journal_action_type,
  p_area journal_area DEFAULT 'system'::journal_area,
  p_details jsonb DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_entity_type text DEFAULT 'unknown',
  p_new_values jsonb DEFAULT NULL,
  p_old_values jsonb DEFAULT NULL,
  p_severity journal_severity DEFAULT 'info'::journal_severity,
  p_summary text DEFAULT '',
  p_tags text[] DEFAULT '{}',
  p_user_id uuid DEFAULT NULL  -- callers should pass auth.uid() explicitly via named arg or rely on COALESCE in body
  )
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_journal_id uuid;
  v_user_role text;
  v_actual_user_id uuid;
  v_now timestamptz;
  v_new_data jsonb;
  v_metadata jsonb;
  v_hash text;
BEGIN
  v_actual_user_id := COALESCE(p_user_id, auth.uid());

  -- Defensive actor resolution: audit_journal.user_id FKs aisha_auth.users
  -- (ON DELETE SET NULL). An authenticated-but-not-yet-provisioned caller
  -- (see public.ensure_current_user) yields a uid absent from aisha_auth.users
  -- — inserting it raises FK 23503 and ROLLS BACK the very operation being
  -- audited. Audit must never block a real operation, and a dangling actor
  -- reference is meaningless: coalesce the unknown actor to NULL (system).
  IF v_actual_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = v_actual_user_id)
  THEN
    v_actual_user_id := NULL;
  END IF;

  IF v_actual_user_id IS NOT NULL THEN
    SELECT ur.role::text INTO v_user_role
    FROM public.user_roles ur
    WHERE ur.user_id = v_actual_user_id
    LIMIT 1;
  END IF;
  
  v_now := now();
  v_new_data := COALESCE(p_details, p_new_values);
  v_metadata := jsonb_build_object(
    'area', p_area::text,
    'severity', p_severity::text,
    'summary', p_summary,
    'user_role', v_user_role,
    'tags', p_tags
  );

  -- Deterministic v2 hash — every input is a stored column of the row being
  -- inserted (created_at as timezone-independent epoch microseconds; jsonb::text
  -- is canonical), so fn_verify_audit_journal_entry can recompute + verify it.
  v_hash := 'v2:' || encode(digest(convert_to(jsonb_build_object(
    'schema', 'aisha.audit_journal.hash.v2',
    'action', p_action_type::text,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'created_at_epoch_us', (extract(epoch FROM v_now) * 1000000)::bigint,
    'new_data', v_new_data,
    'metadata', v_metadata
  )::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.audit_journal (
    user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    new_data,
    blockchain_hash,
    created_at
  ) VALUES (
    v_actual_user_id,
    p_action_type::text,
    p_entity_type,
    p_entity_id,
    v_metadata || jsonb_build_object('blockchain_hash', v_hash),
    v_new_data,
    v_hash,
    v_now
  )
  RETURNING id INTO v_journal_id;
  
  RETURN v_journal_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.write_audit_journal(
  p_action_type journal_action_type,
  p_area journal_area,
  p_details jsonb,
  p_entity_id text,
  p_entity_type text,
  p_new_values jsonb,
  p_old_values jsonb,
  p_severity journal_severity,
  p_summary text,
  p_tags text[],
  p_user_id uuid
  ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.write_audit_journal(
  p_action_type journal_action_type,
  p_area journal_area,
  p_details jsonb,
  p_entity_id text,
  p_entity_type text,
  p_new_values jsonb,
  p_old_values jsonb,
  p_severity journal_severity,
  p_summary text,
  p_tags text[],
  p_user_id uuid
  ) TO service_role;

-- ── record_audit_log — second door to the same forgery
-- Function: public.record_audit_log
-- Arguments: p_action text, p_resource_type text, p_resource_id text, p_user_id uuid, p_details jsonb
-- Description: Wrapper for integration audit logs (edge functions, service role).
-- Security: SECURITY DEFINER. Thin wrapper over write_audit_journal, so it inherits that
--   function's privilege: it forwards p_user_id straight through as the journal actor.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): despite the
--   "edge functions, service role" description above, it was GRANTed to `authenticated` — so it
--   was a second, unguarded door to exactly the audit-attribution forgery that revoking
--   write_audit_journal closes. Revoking only the inner function would have left this one open,
--   which is why both ship in the same commit. Its sole in-DB caller,
--   handle_order_payment_completed, is SECURITY DEFINER and runs as the owner, so it is unaffected.
--   No frontend or service code calls this RPC.

CREATE OR REPLACE FUNCTION public.record_audit_log(
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_user_id uuid DEFAULT NULL::uuid,
  p_details jsonb DEFAULT NULL::jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summary text;
BEGIN
  v_summary := format('Integration event: %s', p_action);

  RETURN public.write_audit_journal(
    p_action_type := 'integration'::journal_action_type,
    p_area := 'integration'::journal_area,
    p_details := jsonb_build_object(
      'action', p_action,
      'details', p_details
    ),
    p_entity_id := p_resource_id,
    p_entity_type := p_resource_type,
    p_new_values := NULL,
    p_old_values := NULL,
    p_severity := 'info'::journal_severity,
    p_summary := v_summary,
    p_tags := ARRAY['integration', 'audit'],
    p_user_id := p_user_id
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.record_audit_log(p_action text, p_resource_type text, p_resource_id text, p_user_id uuid, p_details jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_audit_log(p_action text, p_resource_type text, p_resource_id text, p_user_id uuid, p_details jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_audit_log(p_action text, p_resource_type text, p_resource_id text, p_user_id uuid, p_details jsonb) TO service_role;

-- ── write_my_audit_journal_entry — new narrow browser door
-- Function: public.write_my_audit_journal_entry
-- Arguments: p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_summary text
-- Description: Self-attributed audit entry from a browser session. The ONLY audit-journal writer
--   reachable with a user JWT; write_audit_journal itself is service_role-only as of 2026-07-15.
--
--   WHY THIS EXISTS: write_audit_journal was GRANTed to `authenticated`, and it takes p_user_id.
--   Any logged-in user could therefore POST /rest/v1/rpc/write_audit_journal and author an entry
--   attributed to SOMEONE ELSE — fabricating evidence in the tamper-evident ledger. Worse, the
--   forged row got a VALID blockchain_hash, so fn_verify_audit_chain would attest it as authentic:
--   the hash proves the row was not altered AFTER the fact, it says nothing about who authored it.
--   Revoking the generic writer is the fix; the browser keeps this narrow, self-pinned door.
--   See docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md.
--
-- Security: SECURITY DEFINER. There is deliberately NO p_user_id parameter — the actor is pinned
--   to auth.uid() and cannot be chosen by the caller, which is what makes attribution forgery
--   structurally impossible rather than merely guarded. Severity is likewise fixed at 'info' so a
--   caller cannot forge 'critical' entries and drown real signals. p_action_type/p_area stay
--   caller-supplied but are ENUM-constrained by the database.
-- Params: alphabetical (see src/tests/db/rpc-params-alphabetical.test.ts).
-- @audit: none — this IS the audit writer.

CREATE OR REPLACE FUNCTION public.write_my_audit_journal_entry(
  p_action_type journal_action_type,
  p_area        journal_area DEFAULT 'system'::journal_area,
  p_details     jsonb DEFAULT NULL,
  p_entity_id   text DEFAULT NULL,
  p_entity_type text DEFAULT 'unknown',
  p_new_values  jsonb DEFAULT NULL,
  p_old_values  jsonb DEFAULT NULL,
  p_summary     text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Fail closed: an unauthenticated caller has no identity to attribute the entry to, and an
  -- unattributed "self" entry is meaningless. anon has no grant either — this is defence in depth.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN public.write_audit_journal(
    p_action_type := p_action_type,
    p_area        := p_area,
    p_details     := p_details,
    p_entity_id   := p_entity_id,
    p_entity_type := p_entity_type,
    p_new_values  := p_new_values,
    p_old_values  := p_old_values,
    p_severity    := 'info'::journal_severity,
    p_summary     := p_summary,
    p_tags        := ARRAY['self-reported'],
    p_user_id     := auth.uid()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.write_my_audit_journal_entry(p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_summary text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_my_audit_journal_entry(p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_summary text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_my_audit_journal_entry(p_action_type journal_action_type, p_area journal_area, p_details jsonb, p_entity_id text, p_entity_type text, p_new_values jsonb, p_old_values jsonb, p_summary text) TO service_role;

-- ── fn_check_and_consume_llm_quota_audited — pin quota to the caller (KEEPS its authenticated grant)
-- ============================================================================
-- Source of Truth: fn_check_and_consume_llm_quota_audited
-- Phase 12 WP 2.3 — LLM token rate limit per JWT.sub
--
-- Pre-LLM-call quota gate. Called from svc-ai-chat (and any other service
-- that issues LLM calls on behalf of an authenticated user) BEFORE actually
-- dispatching to the LLM provider. The RPC:
--
--   1. Lazy-creates the user's llm_quota row from llm_tier_defaults('free')
--      on first call
--   2. Resets daily counters if last_reset_at is from a previous day
--   3. Checks both token + cost budgets
--   4. If allowed: increments the counters atomically, returns ok
--   5. If denied: writes an audit_journal entry (security signal — repeated
--      denials = compromised account or runaway script), returns 429 envelope
--
-- IMPORTANT: This is called per LLM call (not per chat turn). The token + cost
-- estimates are PRE-call values; the caller may over-estimate slightly to be
-- safe. Future WP will reconcile post-call actuals via a separate
-- fn_reconcile_llm_consumption RPC (not in this PR).
--
-- Security: SECURITY DEFINER, GRANT EXECUTE TO authenticated + service_role. The function
-- gates on the END-USER identified by p_user_id rather than on the calling service's own
-- token — that is the point of the RPC, and why `authenticated` keeps the grant. What
-- changed on 2026-07-15 is that a non-service caller may now only assert THEMSELVES as
-- p_user_id (see the guard in the body).
--
-- Audit: INSERT INTO audit_journal on DENIAL only. Metadata: tier, reason,
-- requested + consumed counters, limits. NO PII (no user email, no prompt).
-- ============================================================================

-- The third parameter was renamed p_cost_usd → p_cost when hardcoded currency
-- literals were removed from the schema. The SIGNATURE is unchanged
-- (uuid, int, numeric), so the CREATE OR REPLACE below matches the existing
-- function and then fails — Postgres cannot rename an input parameter in place:
--
--   ERROR: cannot change name of input parameter "p_cost_usd"
--
-- This file runs on EVERY migrate, so that error aborted the entire run with
-- exit 1 on any database predating the rename, while a from-baseline database
-- (no prior function) stayed green — the fresh-DB path hid it, and only
-- UPGRADING installs broke. Reproduced locally 2026-07-19: migrate exit 1 at
-- this statement. DROP-first is the convention already used elsewhere in the
-- SoT; the REVOKE/GRANT below re-applies the privileges the drop clears.
DROP FUNCTION IF EXISTS public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric);

CREATE OR REPLACE FUNCTION public.fn_check_and_consume_llm_quota_audited(
  p_user_id  uuid,
  p_tokens   int,
  p_cost numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quota   public.llm_quota%ROWTYPE;
  v_default public.llm_tier_defaults%ROWTYPE;
  v_allowed boolean;
  v_reason  text;
BEGIN
  -- AUTHORIZATION FIRST. The old guard here had two defects (2026-07-15 IDOR audit,
  -- docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md):
  --
  --  (a) It asked only "is SOMEONE authenticated?", never "is p_user_id actually them?".
  --      Combined with the `authenticated` GRANT, any logged-in user could bill their own
  --      LLM spend to a victim's daily quota — raising their effective limit while denying
  --      the victim service, and poisoning the victim's audit trail with the denials.
  --  (b) It read the role GUC directly. NOT a fail-open — an earlier version of the audit claimed
  --      `current_setting('role', true) != 'service_role'` folds to NULL, and that is FALSE:
  --      `role` is a BUILT-IN GUC and returns 'none', never NULL, so the old guard fired correctly.
  --      (Only DOTTED custom GUCs like request.jwt.claims fold to NULL; PostgreSQL rejects undotted
  --      custom GUCs outright.) is_service_role() is used here because it is the canonical reader —
  --      one place that knows the legacy-GUC/JSON-claims compatibility and the SET ROLE case — not
  --      because the old expression was unsafe.
  --
  -- The p_user_id pin below IS the fix. The `authenticated` grant stays (WP 2.3 gates an end user
  -- on their own quota, per JWT.sub) — a grant is not a defect, a grant without an ownership check is.
  IF NOT public.is_service_role()
     AND NOT public.is_admin_or_staff()
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid())
  THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Validate inputs
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_tokens IS NULL OR p_tokens < 0 THEN
    RAISE EXCEPTION 'p_tokens must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN
    RAISE EXCEPTION 'p_cost must be >= 0' USING ERRCODE = '22023';
  END IF;

  -- Lock the row (or upsert from 'free' tier defaults)
  SELECT * INTO v_quota
  FROM public.llm_quota
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Lazy create from free tier defaults
    SELECT * INTO v_default
    FROM public.llm_tier_defaults
    WHERE tier = 'free';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'llm_tier_defaults seed missing — free tier not configured'
        USING ERRCODE = '42704';
    END IF;

    INSERT INTO public.llm_quota (
      user_id, tier, daily_token_limit, daily_cost_limit
    ) VALUES (
      p_user_id, 'free', v_default.daily_token_limit, v_default.daily_cost_limit
    )
    RETURNING * INTO v_quota;
  END IF;

  -- Reset if new day (UTC)
  IF v_quota.last_reset_at < date_trunc('day', now()) THEN
    UPDATE public.llm_quota SET
      consumed_tokens_today = 0,
      consumed_cost_today   = 0,
      last_reset_at         = date_trunc('day', now()),
      updated_at            = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_quota;
  END IF;

  -- Check limits
  IF v_quota.consumed_tokens_today + p_tokens > v_quota.daily_token_limit THEN
    v_allowed := false;
    v_reason  := 'token_limit_exceeded';
  ELSIF v_quota.consumed_cost_today + p_cost > v_quota.daily_cost_limit THEN
    v_allowed := false;
    v_reason  := 'cost_limit_exceeded';
  ELSE
    v_allowed := true;
    v_reason  := 'ok';

    -- Consume atomically (already locked above)
    UPDATE public.llm_quota SET
      consumed_tokens_today = consumed_tokens_today + p_tokens,
      consumed_cost_today   = consumed_cost_today + p_cost,
      updated_at            = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_quota;
  END IF;

  -- AUDIT on denial only — security signal. No PII (only IDs + numeric stats).
  IF NOT v_allowed THEN
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      p_user_id,
      'llm.quota.denied',
      jsonb_build_object(
        'reason',                v_reason,
        'tier',                  v_quota.tier,
        'requested_tokens',      p_tokens,
        'requested_cost',    p_cost,
        'consumed_tokens_today', v_quota.consumed_tokens_today,
        'consumed_cost_today',   v_quota.consumed_cost_today,
        'daily_token_limit',     v_quota.daily_token_limit,
        'daily_cost_limit',  v_quota.daily_cost_limit
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',             v_allowed,
    'reason',              v_reason,
    'remaining_tokens',    GREATEST(0, v_quota.daily_token_limit - v_quota.consumed_tokens_today),
    'remaining_cost',  GREATEST(0, v_quota.daily_cost_limit - v_quota.consumed_cost_today),
    'tier',                v_quota.tier,
    'reset_at',            v_quota.last_reset_at + interval '1 day'
  );
END;
$$;

-- The `authenticated` grant is deliberate and part of the WP 2.3 contract (an end user gates
-- their OWN quota per JWT.sub — src/tests/gates/wp-2-3-llm-quota.gate.test.ts asserts it). It was
-- never the defect: the defect was granting it with no check that p_user_id was the caller, which
-- let one user bill their spend to another's ledger. The guard in the body now enforces that, so
-- the grant is safe — an authenticated caller can only ever consume their own quota.
REVOKE ALL ON FUNCTION public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric) TO service_role;

COMMENT ON FUNCTION public.fn_check_and_consume_llm_quota_audited(uuid, int, numeric) IS
  'Phase 12 WP 2.3 — pre-LLM-call quota gate. Lazy-creates row from free tier, resets daily, atomically consumes, audits denial only. Returns jsonb {allowed, reason, remaining_tokens, remaining_cost, tier, reset_at}.';

-- ── fn_check_and_consume_ai_budget_audited — pin budget + story participation (KEEPS its grant)
-- ============================================================================
-- Source of Truth: fn_check_and_consume_ai_budget_audited
-- Mission Control governance — story-aware spend gate, called at the orchestration
-- control layer (reflection node boundary) with a node's ACTUAL token+USD cost.
--
-- Composition (NOT a parallel mechanism):
--   1. Per-user daily quota — reuse fn_check_and_consume_llm_quota_audited
--      (it consumes + audits its own denial).
--   2. Per-story budget — post-paid metering: record the actual spend against the
--      story's ai_budget row(s) (lifetime/daily/monthly), then signal halt when a
--      cap is reached. A completed LLM call cannot be un-spent, so we meter actuals
--      and stop the NEXT node — accepting a single last-node overshoot.
--   p_story_id NULL or no row → unlimited story side (backward compatible).
--
-- Returns: { allowed, reason ('ok'|'user_quota'|'story_budget'), user_quota, story_state }.
-- Security: SECURITY DEFINER. Audits the story-budget denial (user denial is
-- audited by the per-user RPC). No PII — IDs + numerics only.
-- ============================================================================

-- Same p_cost_usd → p_cost rename as the per-user RPC above, same consequence:
-- the type signature is unchanged, so CREATE OR REPLACE matches the existing
-- function and aborts with "cannot change name of input parameter". Together
-- these two were the ONLY renamed functions carried by this file, and each one
-- failed the whole migrate run on any pre-rename database.
DROP FUNCTION IF EXISTS public.fn_check_and_consume_ai_budget_audited(uuid, uuid, int, numeric);

CREATE OR REPLACE FUNCTION public.fn_check_and_consume_ai_budget_audited(
  p_user_id  uuid,
  p_story_id uuid,
  p_tokens   int,
  p_cost numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_result   jsonb;
  v_user_allowed  boolean := true;
  v_story_allowed boolean := true;
  v_reason        text := 'ok';
  v_row           public.ai_budget%ROWTYPE;
BEGIN
  -- AUTHORIZATION FIRST. The old guard had two defects (2026-07-15 IDOR audit,
  -- docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md):
  --
  --  (a) It asked only "is SOMEONE authenticated?", never whether p_user_id was them or
  --      whether they had any claim on p_story_id. With the `authenticated` GRANT, a
  --      logged-in user could meter spend against ANY user's quota and ANY story's budget —
  --      exhausting a story they cannot even read, which halts its runs (`story_budget`).
  --  (b) It read the role GUC directly. NOT a fail-open — an earlier version of the audit claimed
  --      `current_setting('role', true) <> 'service_role'` folds to NULL, and that is FALSE:
  --      `role` is a BUILT-IN GUC and returns 'none', never NULL. Only DOTTED custom GUCs
  --      (request.jwt.claims) fold to NULL. is_service_role() is used because it is the canonical
  --      reader, not because the old expression was unsafe.
  --
  -- The p_user_id and p_story_id checks are the fix.
  IF NOT public.is_service_role() AND NOT public.is_admin_or_staff() THEN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    IF p_story_id IS NOT NULL AND NOT public.is_story_participant(auth.uid(), p_story_id) THEN
      RAISE EXCEPTION 'Unauthorized: not a story participant' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validate inputs.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_tokens IS NULL OR p_tokens < 0 THEN
    RAISE EXCEPTION 'p_tokens must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN
    RAISE EXCEPTION 'p_cost must be >= 0' USING ERRCODE = '22023';
  END IF;

  -- 1) Per-user daily quota (reuse the existing audited gate — consumes + audits).
  v_user_result := public.fn_check_and_consume_llm_quota_audited(p_user_id, p_tokens, p_cost);
  v_user_allowed := COALESCE((v_user_result ->> 'allowed')::boolean, true);
  IF NOT v_user_allowed THEN
    v_reason := 'user_quota';
  END IF;

  -- 2) Per-story budget — meter actuals across the story's period rows.
  IF p_story_id IS NOT NULL THEN
    FOR v_row IN
      -- Explicit column list (security gate: no SELECT * on real tables).
      -- Order matches public.ai_budget definition for %ROWTYPE compatibility.
      SELECT id, scope_type, scope_id, period, token_limit, cost_limit,
             consumed_tokens, consumed_cost, last_reset_at,
             created_by, created_at, updated_at
      FROM public.ai_budget
      WHERE scope_type = 'story' AND scope_id = p_story_id
      FOR UPDATE
    LOOP
      -- Period reset (daily/monthly) before metering this window.
      IF (v_row.period = 'daily'   AND v_row.last_reset_at < date_trunc('day',   now()))
      OR (v_row.period = 'monthly' AND v_row.last_reset_at < date_trunc('month', now())) THEN
        v_row.consumed_tokens   := 0;
        v_row.consumed_cost := 0;
        v_row.last_reset_at     := now();
      END IF;

      -- Meter the actual spend (post-paid).
      v_row.consumed_tokens   := v_row.consumed_tokens   + p_tokens;
      v_row.consumed_cost := v_row.consumed_cost + p_cost;

      UPDATE public.ai_budget SET
        consumed_tokens   = v_row.consumed_tokens,
        consumed_cost = v_row.consumed_cost,
        last_reset_at     = v_row.last_reset_at,
        updated_at        = now()
      WHERE id = v_row.id;

      -- Cap reached on either limited dimension?
      IF (v_row.token_limit    IS NOT NULL AND v_row.consumed_tokens   >= v_row.token_limit)
      OR (v_row.cost_limit IS NOT NULL AND v_row.consumed_cost >= v_row.cost_limit) THEN
        v_story_allowed := false;
      END IF;
    END LOOP;

    IF NOT v_story_allowed AND v_user_allowed THEN
      v_reason := 'story_budget';
    END IF;
  END IF;

  -- Audit the story-budget denial only (user denial already audited by its RPC).
  IF NOT v_story_allowed THEN
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (
      p_user_id,
      'ai.budget.denied',
      jsonb_build_object(
        'reason',             'story_budget',
        'story_id',           p_story_id,
        'requested_tokens',   p_tokens,
        'requested_cost', p_cost
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',     (v_user_allowed AND v_story_allowed),
    'reason',      v_reason,
    'user_quota',  v_user_result,
    'story_state', CASE WHEN p_story_id IS NULL THEN 'ok'
                        WHEN v_story_allowed     THEN 'ok'
                        ELSE 'stopped' END
  );
END;
$$;

-- The `authenticated` grant is part of the design contract (asserted by
-- src/tests/gates/ai-budget.gate.test.ts, mirroring WP 2.3's per-JWT.sub gating), even though the
-- only caller today is svc-ai-chat's reflection orchestrator
-- (services/svc-ai-chat/src/reflection/orchestrator.ts), which reaches PostgREST through
-- @aisha/postgrest-client with the service_role bearer token. The grant was never the defect:
-- granting it with no check that p_user_id was the caller, and no check that they had any claim
-- on p_story_id, was. The guard in the body enforces both, so the grant is safe.
REVOKE ALL ON FUNCTION public.fn_check_and_consume_ai_budget_audited(uuid, uuid, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_and_consume_ai_budget_audited(uuid, uuid, int, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_and_consume_ai_budget_audited(uuid, uuid, int, numeric) TO service_role;

-- ── mcp_get_agent_memories — wildcard -> caller-scoped
-- Function: mcp_get_agent_memories
-- Retrieves filtered agent memories (by slug, user, type, importance) for MCP tool access.
-- Respects expiry dates; returns JSONB with status, count, and memory array.
-- Security: SECURITY DEFINER (so it bypasses RLS on agent_memories) + caller-scoped p_user_id.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): p_user_id defaults to
--   NULL and the predicate was `p_user_id IS NULL OR am.user_id = p_user_id` — so NULL meant ALL
--   USERS. With the `authenticated` grant, OMITTING the argument dumped every user's agent
--   memories (agent_memories.content is conversation memory, i.e. PII) to any logged-in caller:
--   POST /rest/v1/rpc/mcp_get_agent_memories {"p_agent_slug":"..."}. Not a targeted IDOR — a bulk
--   read, and the most damaging shape of this class, because the attacker needs no victim id.
--   The wildcard is legitimate for trusted callers, so it is not removed: it is now resolved from
--   the caller's identity, and only service_role/admin may still request it.

CREATE OR REPLACE FUNCTION public.mcp_get_agent_memories(p_agent_slug text, p_user_id uuid DEFAULT NULL::uuid, p_memory_type text DEFAULT NULL::text, p_min_importance integer DEFAULT 1, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_memories jsonb;
  v_user_id  uuid;
BEGIN
  -- Resolve the effective scope BEFORE reading. service_role (the MCP/agent runtimes) and
  -- admin/staff keep the cross-user wildcard; everyone else is pinned to themselves, so a
  -- NULL p_user_id collapses to "my memories" instead of "everyone's".
  IF public.is_service_role() OR public.is_admin_or_staff() THEN
    v_user_id := p_user_id;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    -- Asking for someone else is a deliberate probe: refuse rather than silently self-scope,
    -- so the caller learns its request was denied instead of trusting a wrong answer.
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', am.id,
    'memory_type', am.memory_type,
    'content', am.content,
    'importance', am.importance,
    'created_at', am.created_at,
    'expires_at', am.expires_at
  ) ORDER BY am.importance DESC, am.created_at DESC), '[]'::jsonb)
  INTO v_memories
  FROM agent_memories am
  WHERE am.agent_slug = p_agent_slug
    AND (v_user_id IS NULL OR am.user_id = v_user_id)
    AND (p_memory_type IS NULL OR am.memory_type = p_memory_type)
    AND am.importance >= p_min_importance
    AND (am.expires_at IS NULL OR am.expires_at > now());

  RETURN jsonb_build_object(
    'status', 'ok',
    'agent_slug', p_agent_slug,
    'count', jsonb_array_length(v_memories),
    'memories', v_memories
  );
END;
$function$;

REVOKE ALL ON FUNCTION mcp_get_agent_memories(text, uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_get_agent_memories(text,uuid,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_get_agent_memories(text,uuid,text,integer,integer) TO service_role;

-- ── mcp_summarize_agent_memories — same wildcard
-- Function: mcp_summarize_agent_memories
-- Security: SECURITY DEFINER (bypasses RLS on agent_memories) + caller-scoped p_user_id.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): p_user_id defaults to
--   NULL and every predicate treated a NULL p_user_id as "match every user". Granted to
--   `authenticated`, omitting the argument returned a cross-user census — total count, a breakdown
--   by memory_type, and the top-5 memory CONTENTS (200 chars each, PII) over every user of that
--   agent. Same wildcard defect as mcp_get_agent_memories; fixed the same way, so the two cannot
--   drift apart.

CREATE OR REPLACE FUNCTION public.mcp_summarize_agent_memories(p_agent_slug text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summary jsonb;
  v_total integer;
  v_by_type jsonb;
  v_top_memories jsonb;
  v_user_id uuid;
BEGIN
  -- Resolve the effective scope BEFORE reading. service_role (the MCP/agent runtimes) and
  -- admin/staff keep the cross-user wildcard; everyone else is pinned to themselves, so a
  -- NULL p_user_id collapses to "my memories" instead of "everyone's".
  IF public.is_service_role() OR public.is_admin_or_staff() THEN
    v_user_id := p_user_id;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  END IF;

  -- Count total active memories
  SELECT count(*) INTO v_total
  FROM agent_memories am
  WHERE am.agent_slug = p_agent_slug
    AND (v_user_id IS NULL OR am.user_id = v_user_id)
    AND (am.expires_at IS NULL OR am.expires_at > now());

  -- Count by type
  SELECT COALESCE(jsonb_object_agg(memory_type, cnt), '{}'::jsonb) INTO v_by_type
  FROM (
    SELECT am.memory_type, count(*) as cnt
    FROM agent_memories am
    WHERE am.agent_slug = p_agent_slug
      AND (v_user_id IS NULL OR am.user_id = v_user_id)
      AND (am.expires_at IS NULL OR am.expires_at > now())
    GROUP BY am.memory_type
  ) sub;

  -- Top 5 by importance
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'memory_type', am.memory_type,
    'content', left(am.content, 200),
    'importance', am.importance
  ) ORDER BY am.importance DESC, am.created_at DESC), '[]'::jsonb)
  INTO v_top_memories
  FROM (
    SELECT am2.memory_type, am2.content, am2.importance, am2.created_at
    FROM agent_memories am2
    WHERE am2.agent_slug = p_agent_slug
      AND (v_user_id IS NULL OR am2.user_id = v_user_id)
      AND (am2.expires_at IS NULL OR am2.expires_at > now())
    ORDER BY am2.importance DESC, am2.created_at DESC
    LIMIT 5
  ) am;

  RETURN jsonb_build_object(
    'status', 'ok',
    'agent_slug', p_agent_slug,
    'total_memories', v_total,
    'by_type', v_by_type,
    'top_memories', v_top_memories
  );
END;
$function$;

REVOKE ALL ON FUNCTION mcp_summarize_agent_memories(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_summarize_agent_memories(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mcp_summarize_agent_memories(text,uuid) TO service_role;

-- ── fn_search_agent_memories — same wildcard
-- fn_search_agent_memories: Vector-based semantic search over agent memories
-- Uses hybrid scoring: cosine similarity (60%) + importance weight (40%)
-- Called from ai-context-composer edge function for relevance-ranked memory retrieval.

CREATE OR REPLACE FUNCTION public.fn_search_agent_memories(
  p_query_embedding vector(1536),
  p_agent_slug text,
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10,
  p_min_importance integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_results jsonb;
  v_user_id uuid;
BEGIN
  -- Resolve the effective scope BEFORE reading. The previous guard asked only "is SOMEONE
  -- authenticated?" while p_user_id defaulted to NULL and NULL meant "match every user"
  -- (2026-07-15 IDOR audit, docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md) — so any logged-in
  -- caller could semantically search every user's agent memories (PII) with one embedding.
  -- service_role (the MCP/agent runtimes) and admin/staff keep the cross-user wildcard; everyone
  -- else is pinned to themselves. Memories with am.user_id IS NULL are agent-global, not
  -- user-owned, and stay visible to all — that disjunct is intentional, not part of the defect.
  IF public.is_service_role() OR public.is_admin_or_staff() THEN
    v_user_id := p_user_id;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    v_user_id := auth.uid();
  END IF;

  -- Validate inputs
  IF p_query_embedding IS NULL THEN
    RAISE EXCEPTION 'p_query_embedding is required';
  END IF;
  IF p_agent_slug IS NULL OR p_agent_slug = '' THEN
    RAISE EXCEPTION 'p_agent_slug is required';
  END IF;

  SELECT COALESCE(jsonb_agg(sub.obj ORDER BY sub.hybrid_score DESC), '[]'::jsonb)
  INTO v_results
  FROM (
    SELECT
      jsonb_build_object(
        'memory_id', am.id,
        'type', am.memory_type,
        'content', am.content,
        'importance', am.importance,
        'cosine_similarity', round((1 - (am.embedding <=> p_query_embedding))::numeric, 4),
        'hybrid_score', round((
          (1 - (am.embedding <=> p_query_embedding)) * 0.6
          + (am.importance / 10.0) * 0.4
        )::numeric, 4),
        'created_at', am.created_at
      ) AS obj,
      (1 - (am.embedding <=> p_query_embedding)) * 0.6
        + (am.importance / 10.0) * 0.4
      AS hybrid_score
    FROM agent_memories am
    WHERE am.agent_slug = p_agent_slug
      AND am.embedding IS NOT NULL
      AND am.importance >= p_min_importance
      AND (am.expires_at IS NULL OR am.expires_at > now())
      AND (v_user_id IS NULL OR am.user_id IS NULL OR am.user_id = v_user_id)
    LIMIT p_limit
  ) sub;

  RETURN jsonb_build_object(
    'memories', v_results,
    'count', jsonb_array_length(v_results),
    'search_method', 'vector_hybrid'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_search_agent_memories(vector(1536), text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_search_agent_memories(vector(1536), text, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_search_agent_memories(vector(1536), text, uuid, integer, integer) TO service_role;

-- ── add_system_timeline_entry — forged 'system_' provenance
-- Function: add_system_timeline_entry
-- Purpose: System trigger adds automatic entries to member timeline
-- Access: Internal only (called by triggers)
-- Security: SECURITY DEFINER with audit logging. Internal-only per the line above — and yet it
--   was GRANTed to `authenticated` until the 2026-07-15 IDOR fix
--   (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md). Any logged-in user could call it with
--   another user's p_user_id and fabricate 'system_'-prefixed entries — system_lab_result,
--   system_payment, system_document — in that user's timeline. Those entry types exist precisely
--   to mark records the PLATFORM vouches for, as opposed to what a member wrote themselves, so
--   forging them is forging provenance: a fabricated lab result or payment in someone's medical
--   timeline, indistinguishable from a real one. The v_system_types check bounded the TYPE of the
--   forgery, never the AUTHOR — it reads as a guard and is not one.
--   Its 12 callers are trigger functions: SECURITY DEFINER, executed as the owner, who keeps
--   EXECUTE by ownership. Nothing outside the database calls it, so the grant bought nothing.

CREATE OR REPLACE FUNCTION public.add_system_timeline_entry(
  p_user_id UUID,
  p_entry_type TEXT,
  p_content TEXT,
  p_metadata JSONB DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL,
  p_source_table TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_story RECORD;
  v_entry_id UUID;
  v_system_types TEXT[] := ARRAY[
    'system_registration',
    'system_order', 
    'system_lab_result',
    'system_check_in',
    'system_payment',
    'system_document',
    'system_questionnaire',
    'system_dosing',
    'system_health_sync'
  ];
BEGIN
  -- Validate entry type (only system types allowed)
  IF NOT (p_entry_type = ANY(v_system_types)) THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid system entry type: %s. Allowed: %s', p_entry_type, v_system_types::text), ERRCODE = '22023';
  END IF;

  -- Find user's primary story (or create one if not exists)
  SELECT ps.id
  INTO v_story
  FROM partner_stories ps
  WHERE ps.user_id = p_user_id
  ORDER BY ps.created_at ASC
  LIMIT 1;

  -- If user has no story, skip (they haven't opted into timeline yet)
  IF v_story.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_story'
    );
  END IF;

  -- Check for duplicate (same source within 1 minute to prevent trigger re-fires)
  IF p_source_table IS NOT NULL AND p_source_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM story_entries se
      WHERE se.story_id = v_story.id
        AND se.entry_type = p_entry_type
        AND se.metadata->>'source_table' = p_source_table
        AND (se.metadata->>'source_id')::uuid = p_source_id
        AND se.created_at > now() - interval '1 minute'
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'duplicate'
      );
    END IF;
  END IF;

  -- Create entry
  INSERT INTO story_entries (
    story_id,
    entry_type,
    content,
    metadata,
    occurred_at,
    created_by,
    is_internal
  )
  VALUES (
    v_story.id,
    p_entry_type,
    p_content,
    jsonb_build_object(
      'source_table', p_source_table,
      'source_id', p_source_id,
      'is_system', true
    ) || COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_occurred_at, now()),
    NULL,  -- System entries have no created_by
    false  -- Visible to partner
  )
  RETURNING id INTO v_entry_id;

  -- Update story last_activity_at
  UPDATE partner_stories
  SET last_activity_at = now()
  WHERE id = v_story.id;

  -- Audit log (no sensitive data!)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    p_user_id,
    'TIMELINE_SYSTEM_ENTRY',
    jsonb_build_object(
      'area', 'member_timeline',
      'severity', 'info',
      'entity_type', 'story_entry',
      'entity_id', v_entry_id,
      'entry_type', p_entry_type,
      'story_id', v_story.id,
      'source_table', p_source_table,
      'source_id', p_source_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'story_id', v_story.id
  );
END;
$$;

-- Security: This is internal function, but grant to authenticated for testing
REVOKE ALL ON FUNCTION public.add_system_timeline_entry(uuid, text, text, jsonb, timestamptz, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_system_timeline_entry(uuid, text, text, jsonb, timestamptz, text, uuid) TO service_role;

COMMENT ON FUNCTION public.add_system_timeline_entry(uuid, text, text, jsonb, timestamptz, text, uuid) IS 'System function to add automatic timeline entries from triggers. Internal use only.';

-- ── create_notification — phishing primitive
-- Function: public.create_notification
-- Arguments: p_user_id uuid, p_title text, p_message text, p_type text, p_link text
-- Description: Internal notification writer. Inserts a row into another user's notification feed
--   on behalf of a trusted caller — never on behalf of the browser.
-- Security: SECURITY DEFINER, service_role + in-DB SECURITY DEFINER callers only.
--   2026-07-15 IDOR fix (docs/security/IDOR_P_USER_ID_AUDIT_2026-07-15.md): GRANTed to
--   `authenticated` with no authorization and no validation, this was a phishing primitive —
--   any logged-in user could POST /rest/v1/rpc/create_notification and place an arbitrary
--   title, message and LINK into ANY user's notification feed, where the UI renders it as a
--   trusted first-party message. Nothing in the codebase calls this RPC, so the grant bought
--   nothing. src/tests/gates/security-hardened-helpers.gate.test.ts already listed this
--   function as MUST_BE_INTERNAL_ONLY, but its assertion was commented out pending a "Phase 2"
--   that never landed, so the violation only ever surfaced as a console.warn. That assertion is
--   enabled in the same commit as this fix.
-- Extracted: 2026-01-08T18:26:06+01:00

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_title text, p_message text, p_type text DEFAULT 'info'::text, p_link text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (user_id, title, message, type, link)
  VALUES (p_user_id, p_title, p_message, p_type, p_link)
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_notification(p_user_id uuid, p_title text, p_message text, p_type text, p_link text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(p_user_id uuid, p_title text, p_message text, p_type text, p_link text) TO service_role;


-- ── heal #37b: strip the OLD explicit grants (the part REVOKE ... FROM PUBLIC misses) ──
REVOKE ALL ON FUNCTION public.award_tokens(uuid,text,integer,text,uuid,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.award_tokens(uuid,text,integer,text,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.write_audit_journal(journal_action_type,journal_area,jsonb,text,text,jsonb,jsonb,journal_severity,text,text[],uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.write_audit_journal(journal_action_type,journal_area,jsonb,text,text,jsonb,jsonb,journal_severity,text,text[],uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_audit_log(text,text,text,uuid,jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.record_audit_log(text,text,text,uuid,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.add_system_timeline_entry(uuid,text,text,jsonb,timestamptz,text,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.add_system_timeline_entry(uuid,text,text,jsonb,timestamptz,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_notification(uuid,text,text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_notification(uuid,text,text,text,text) FROM anon;


-- ── heal #38: get_my_membership returns tokens_aisha (membership was null in prod) ──
-- WHY A HEAL: the baseline is never re-applied to an existing DB (this file's header;
-- scripts/db/migrate.mjs:468). Fixing aisha/db/sql/functions/get_my_membership.sql fixes
-- `main` and cold starts, and changes NOTHING in production. This block is the only path.
--
-- THE BUG: the function's RETURNS TABLE omitted tokens_aisha while memberships has four
-- token columns. src/lib/schemas/hookSchemas.ts:28 declares tokens_aisha as
-- z.number().nullable() — a nullable VALUE, not an optional KEY — so every row failed the
-- schema with {"path":["tokens_aisha"],"message":"Required"}, parseFirstItemSafe swallowed
-- the ZodError and returned null, and **membership was null for every web user**. Every token
-- balance rendered 0 (useTokens reads `membership?.tokens_aisha || 0`) and every
-- membership-gated surface rendered empty — silently, with nothing red.
-- Verified by executing the real production row against the real schema:
--   safeParse success: false | invalid_type, received "undefined", path ["tokens_aisha"]
--
-- Idempotent: a single CREATE OR REPLACE. No grants change, so no explicit role REVOKE is
-- needed here (see heal #37: REVOKE ... FROM PUBLIC does not strip an explicit role grant —
-- that only matters when a grant is being taken away, which it is not).
--
-- NOTE the return TYPE changes (a column is added), so this is a DROP-free replace only
-- because PostgreSQL allows adding OUT columns via CREATE OR REPLACE for a TABLE-returning
-- function ONLY when the existing columns keep their names/types/order. tokens_aisha is
-- inserted BEFORE tokens_governance, which reorders them — so the replace requires a DROP.
-- Dropping is safe: it is a STABLE read-only function, and the replace is in the same
-- transaction as the drop.
BEGIN;
DROP FUNCTION IF EXISTS public.get_my_membership();
-- Function: public.get_my_membership
-- Arguments: (none)
-- Description: The caller's current membership, including all four token balances.
-- Security: SECURITY DEFINER, row_security ON, scoped to auth.uid(). STABLE, read-only.
--
-- 2026-07-15 FIX — this RETURNS TABLE omitted tokens_aisha while memberships has FOUR
-- token columns, and src/lib/schemas/hookSchemas.ts:28 declares
--   tokens_aisha: z.number().nullable()
-- .nullable() permits a null VALUE, not an ABSENT KEY (that is .optional()). So the row
-- this function returned failed the schema with {"path":["tokens_aisha"],"message":"Required"},
-- parseFirstItemSafe swallowed the ZodError and returned null, and **membership was null for
-- every web user in production** — silently. useTokens() reads
-- `membership?.tokens_aisha || 0`, so every balance rendered as 0 and every
-- membership-gated surface rendered empty, with nothing red anywhere.
--
-- The safeParse-returns-null shape is why nobody saw it: a fallback that hides a broken
-- contract instead of failing loud. The contract is fixed here, at the source.
--
-- Keep this projection in step with memberships' token columns. The role decoupling renames
-- tokens_aisha -> tokens_utility; this function moves with it.

CREATE OR REPLACE FUNCTION public.get_my_membership()
 RETURNS TABLE(id uuid, user_id uuid, tier membership_tier, status membership_status, payment_type payment_type, subscription_period subscription_period, stripe_subscription_id text, stripe_customer_id text, starts_at timestamptz, expires_at timestamptz, auto_renew boolean, tokens_aisha integer, tokens_governance integer, tokens_impact integer, tokens_data integer, notes text, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'on'
AS $function$
  SELECT
    m.id,
    m.user_id,
    m.tier,
    m.status,
    m.payment_type,
    m.subscription_period,
    m.stripe_subscription_id,
    m.stripe_customer_id,
    m.starts_at,
    m.expires_at,
    m.auto_renew,
    m.tokens_aisha,
    m.tokens_governance,
    m.tokens_impact,
    m.tokens_data,
    m.notes,
    m.created_at,
    m.updated_at
  FROM public.memberships m
  WHERE m.user_id = auth.uid()
  ORDER BY m.created_at DESC
  LIMIT 1;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_membership() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_membership() TO authenticated;
COMMIT;

-- ============================================================================
-- Currency-suffix parameter renames — refresh on the UPGRADE path
-- ============================================================================
-- Removing hardcoded currency literals renamed parameters and RETURNS TABLE
-- columns (p_cost_usd → p_cost, p_estimated_cost_usd → p_estimated_cost, …)
-- across the function source-of-truth. The baseline carries the new names, but
-- the baseline is never re-applied to an initialized database — so every
-- already-deployed instance kept the OLD names indefinitely while the
-- application moved to the new ones. PostgREST resolves RPCs by ARGUMENT NAME,
-- so those calls fail with PGRST202 "function not found" on exactly the
-- installs that upgraded rather than wiped.
--
-- Each block below drops the old signature (types are unchanged, so one DROP
-- covers both spellings) and re-creates from the source of truth. Verified: none
-- of these functions has a dependent object, so no drop can cascade-fail.
-- ============================================================================

-- ── fn_detect_agent_runaway — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/fn_detect_agent_runaway.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- Function: public.fn_detect_agent_runaway
-- Description: GOAL 2 — the autonomous supervisor analysis pass. Scans LIVE agent
--   sessions (agent_live_sessions × ai_trace_events cost rollup) and, for any run
--   over the runtime / token / cost thresholds, queues a Dirigent nudge (advisory,
--   drained on the next hook by the relay). Idempotent per session within the
--   nudge window. Thresholds are ARGUMENTS (operator/config-driven — no policy
--   baked as a literal). Returns the number of nudges created.
--   Closes the plan's GOAL 2 (something actually analyses the ingested activity)
--   and the "Automatický supervisor trigger" (driven by WF_DIRIGENT_AGENT_WATCHDOG).
-- Security: SECURITY DEFINER, read-mostly + queue insert. service_role + authenticated.

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.fn_detect_agent_runaway(integer, bigint, numeric);

CREATE OR REPLACE FUNCTION public.fn_detect_agent_runaway(
  p_max_runtime_minutes int     DEFAULT 15,
  p_max_tokens          bigint  DEFAULT NULL,
  p_max_cost        numeric DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count    int := 0;
  v_row      record;
  v_reason   text;
  v_user_id  uuid := auth.uid();
BEGIN
  -- Supervisor-scope: this pass enumerates ALL users' live sessions, so it is
  -- restricted to admins/staff and the service_role watchdog. A regular
  -- authenticated caller must not be able to scan other users' agent activity.
  -- Robust allow-list (COALESCE guards the NULL-role / NULL-uid edges).
  IF NOT (
       COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
       OR COALESCE(public.is_admin_or_staff(v_user_id), false)
     )
  THEN
    RAISE EXCEPTION 'fn_detect_agent_runaway requires admin/staff or service_role'
      USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    -- Cost rollup uses the SAME canonical predicate as list_active_agent_sessions
    -- and finish_ai_run: ai_trace_events.run_id = the session's per-session ai_run
    -- (agent_live_sessions.ai_run_id). Joining on session_id via request_summary
    -- would be fragile (relays don't guarantee that key) and silently zero-out the
    -- token/cost thresholds.
    SELECT s.session_id,
           s.story_id,
           s.source,
           s.agent_run_id,
           (EXTRACT(EPOCH FROM (now() - s.started_at)) / 60)::int AS runtime_min,
           COALESCE(tc.tokens, 0) AS tokens,
           COALESCE(tc.usd, 0)    AS cost
    FROM public.agent_live_sessions s
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE((ate.cost_json->>'tokens_in')::bigint, 0)
               + COALESCE((ate.cost_json->>'tokens_out')::bigint, 0)) AS tokens,
             SUM(COALESCE((ate.cost_json->>'usd')::numeric, 0))       AS usd
      FROM public.ai_trace_events ate
      WHERE ate.run_id = s.ai_run_id
    ) tc ON s.ai_run_id IS NOT NULL
    WHERE s.current_phase <> 'stopped'
      AND s.updated_at > now() - interval '2 hours'   -- ignore stale rows
  LOOP
    -- Threshold check (first breached dimension wins the message).
    v_reason := NULL;
    IF v_row.runtime_min >= p_max_runtime_minutes THEN
      v_reason := format('running %s min with no Stop', v_row.runtime_min);
    ELSIF p_max_tokens IS NOT NULL AND v_row.tokens >= p_max_tokens THEN
      v_reason := format('%s tokens used (>= %s)', v_row.tokens, p_max_tokens);
    ELSIF p_max_cost IS NOT NULL AND v_row.cost >= p_max_cost THEN
      v_reason := format('$%s spent (>= $%s)', v_row.cost, p_max_cost);
    END IF;
    IF v_reason IS NULL THEN CONTINUE; END IF;

    -- Idempotent: one live watchdog nudge per session within the window.
    IF EXISTS (
      SELECT 1 FROM public.dirigent_nudges n
      WHERE n.event_origin = 'agent_watchdog'
        AND n.consumed_at IS NULL
        AND n.expires_at > now()
        AND n.metadata->>'session_id' = v_row.session_id
    ) THEN CONTINUE; END IF;

    INSERT INTO public.dirigent_nudges (story_id, event_origin, severity, message, metadata, expires_at)
    VALUES (
      v_row.story_id,
      'agent_watchdog',
      'warn',
      format('Agent session %s (%s) %s — consider checking in or stopping the run.',
             v_row.session_id, v_row.source, v_reason),
      jsonb_build_object(
        'session_id', v_row.session_id,
        'agent_run_id', v_row.agent_run_id,
        'runtime_min', v_row.runtime_min,
        'tokens', v_row.tokens,
        'cost', v_row.cost),
      now() + interval '1 hour'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_agent_runaway(int, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_detect_agent_runaway(int, bigint, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_detect_agent_runaway(int, bigint, numeric) TO authenticated;

COMMENT ON FUNCTION public.fn_detect_agent_runaway(int, bigint, numeric) IS
  'GOAL 2 autonomous supervisor pass: scans live agent_live_sessions x ai_trace_events cost rollup; queues a Dirigent nudge (event_origin=agent_watchdog) for runs over the runtime/token/cost thresholds, idempotent per session. Returns nudge count. Driven by n8n WF_DIRIGENT_AGENT_WATCHDOG.';

-- ── fn_record_rag_eval_run_audited — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/fn_record_rag_eval_run_audited.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- ============================================================================
-- Source of Truth: fn_record_rag_eval_run_audited
-- Popis: Persist a single eval run row in public.rag_eval_runs with all 4
--        RAGAS-style scores + audit_journal entry. Called per golden row
--        by services/svc-mcp-knowledge/src/routes/rag-eval.ts.
--
-- Step:   Step 0 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + service_role only
-- Audit:  INSERT INTO audit_journal (action='rag_eval.run_recorded', metadata)
-- Source migration: aisha/db/migrations/20260518200000_rag_eval_foundation.sql
-- ============================================================================

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.fn_record_rag_eval_run_audited(
  p_golden_id                uuid,
  p_batch_id                 uuid,
  p_embedding_model          text,
  p_embedding_model_version  text,
  p_llm_model                text,
  p_judge_model              text,
  p_context_profile_slug     text,
  p_retrieved_chunk_ids      uuid[],
  p_generated_answer         text,
  p_scores                   jsonb,
  p_latency_ms               integer,
  p_cost                 numeric,
  p_ai_run_id                uuid DEFAULT NULL,
  p_metadata                 jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_golden_id IS NULL THEN
    RAISE EXCEPTION 'p_golden_id is required';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'p_batch_id is required';
  END IF;
  IF p_embedding_model IS NULL OR p_embedding_model = '' THEN
    RAISE EXCEPTION 'p_embedding_model is required';
  END IF;
  IF p_llm_model IS NULL OR p_llm_model = '' THEN
    RAISE EXCEPTION 'p_llm_model is required';
  END IF;

  INSERT INTO public.rag_eval_runs (
    golden_id, batch_id, embedding_model, embedding_model_version,
    llm_model, judge_model, context_profile_slug, retrieved_chunk_ids,
    generated_answer,
    faithfulness_score, answer_relevancy_score,
    context_precision_score, context_recall_score,
    latency_ms, cost, metadata, ai_run_id
  ) VALUES (
    p_golden_id, p_batch_id, p_embedding_model, p_embedding_model_version,
    p_llm_model, p_judge_model, p_context_profile_slug, COALESCE(p_retrieved_chunk_ids, '{}'::uuid[]),
    p_generated_answer,
    NULLIF(p_scores->>'faithfulness', '')::numeric,
    NULLIF(p_scores->>'answer_relevancy', '')::numeric,
    NULLIF(p_scores->>'context_precision', '')::numeric,
    NULLIF(p_scores->>'context_recall', '')::numeric,
    p_latency_ms, p_cost, COALESCE(p_metadata, '{}'::jsonb), p_ai_run_id
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'rag_eval.run_recorded',
    jsonb_build_object(
      'run_id', v_run_id,
      'golden_id', p_golden_id,
      'batch_id', p_batch_id,
      'embedding_model', p_embedding_model,
      'llm_model', p_llm_model,
      'profile', p_context_profile_slug,
      'scores', p_scores,
      'chunk_count', COALESCE(array_length(p_retrieved_chunk_ids, 1), 0),
      'latency_ms', p_latency_ms,
      'cost', p_cost
    )
  );

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) TO service_role;
-- service_role ONLY — no end user records an eval run. REVOKE ... FROM PUBLIC does
-- NOT remove a grant made explicitly to a role, so a database that once granted
-- this to authenticated would silently keep it. Revoke by name so the intent
-- reaches an already-deployed instance too (heals-revoke-reaches-existing-db gate).
REVOKE ALL ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) FROM anon;

COMMENT ON FUNCTION public.fn_record_rag_eval_run_audited(uuid, uuid, text, text, text, text, text, uuid[], text, jsonb, integer, numeric, uuid, jsonb) IS
  'Persist single eval run with all 4 RAGAS-style scores; writes audit row (rag_eval.run_recorded). Service-role only.';

-- ── submit_batch_job — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/submit_batch_job.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- Function: submit_batch_job
-- Registers a batch job in ai_batch_jobs after the provider's batch endpoint
-- has accepted the JSONL request. Returns the local UUID of the batch row.
-- The actual provider POST is performed by the TS batchSubmitter helper —
-- this RPC is the authoritative state-write.

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.submit_batch_job(text, text, integer, jsonb, uuid, text, uuid, numeric);

CREATE OR REPLACE FUNCTION public.submit_batch_job(
  p_provider text,
  p_external_batch_id text,
  p_request_count int,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_related_run_id uuid DEFAULT NULL,
  p_agent_slug text DEFAULT 'aisha',
  p_story_id uuid DEFAULT NULL,
  p_estimated_cost numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN ('anthropic', 'openai') THEN
    RAISE EXCEPTION 'Invalid provider: %', p_provider USING ERRCODE = '22023';
  END IF;
  IF p_external_batch_id IS NULL OR p_external_batch_id = '' THEN
    RAISE EXCEPTION 'p_external_batch_id is required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_request_count, 0) <= 0 THEN
    RAISE EXCEPTION 'p_request_count must be > 0' USING ERRCODE = '22023';
  END IF;

  v_user_id := auth.uid();

  INSERT INTO ai_batch_jobs (
    provider,
    external_batch_id,
    status,
    request_count,
    estimated_cost,
    related_run_id,
    agent_slug,
    story_id,
    metadata,
    created_by
  )
  VALUES (
    p_provider,
    p_external_batch_id,
    'submitted',
    p_request_count,
    p_estimated_cost,
    p_related_run_id,
    p_agent_slug,
    p_story_id,
    COALESCE(p_metadata, '{}'::jsonb),
    v_user_id
  )
  RETURNING id INTO v_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'batch.job_submitted',
    jsonb_build_object(
      'batch_job_id', v_id,
      'provider', p_provider,
      'external_batch_id', p_external_batch_id,
      'request_count', p_request_count,
      'related_run_id', p_related_run_id,
      'agent_slug', p_agent_slug,
      'story_id', p_story_id
    )
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.submit_batch_job(text, text, int, jsonb, uuid, text, uuid, numeric) IS
  'Records a batch job after provider acceptance. Returns local UUID of ai_batch_jobs row.';

REVOKE ALL ON FUNCTION public.submit_batch_job(text, text, int, jsonb, uuid, text, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_batch_job(text, text, int, jsonb, uuid, text, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_batch_job(text, text, int, jsonb, uuid, text, uuid, numeric) TO service_role;

-- ── update_batch_job_status — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/update_batch_job_status.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- Function: update_batch_job_status
-- Polling helper: WF_BATCH_POLLER (n8n) calls this after fetching provider
-- batch state. Records last_polled_at on every call so we can detect stalled
-- pollers and rate-limit per-job polls. Transitions status and persists cost
-- + result URL on completion.

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.update_batch_job_status(text, text, text, text, numeric, integer, integer);

CREATE OR REPLACE FUNCTION public.update_batch_job_status(
  p_provider text,
  p_external_batch_id text,
  p_status text,
  p_result_url text DEFAULT NULL,
  p_actual_cost numeric DEFAULT NULL,
  p_succeeded_count int DEFAULT NULL,
  p_errored_count int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job       RECORD;
  v_completed_at timestamptz;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN ('anthropic', 'openai') THEN
    RAISE EXCEPTION 'Invalid provider: %', p_provider USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('submitted', 'in_progress', 'completed', 'expired', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM ai_batch_jobs
  WHERE provider = p_provider AND external_batch_id = p_external_batch_id
  FOR UPDATE;

  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Batch job %/% not found', p_provider, p_external_batch_id USING ERRCODE = '22023';
  END IF;

  v_completed_at := CASE
    WHEN p_status IN ('completed', 'expired', 'failed', 'cancelled')
         AND v_job.completed_at IS NULL
    THEN now()
    ELSE v_job.completed_at
  END;

  UPDATE ai_batch_jobs
  SET status = p_status,
      last_polled_at = now(),
      completed_at = v_completed_at,
      result_url = COALESCE(p_result_url, result_url),
      actual_cost = COALESCE(p_actual_cost, actual_cost),
      succeeded_count = COALESCE(p_succeeded_count, succeeded_count),
      errored_count = COALESCE(p_errored_count, errored_count),
      updated_at = now()
  WHERE id = v_job.id;

  IF p_status != v_job.status THEN
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      auth.uid(),
      'batch.status_changed',
      jsonb_build_object(
        'batch_job_id', v_job.id,
        'provider', p_provider,
        'external_batch_id', p_external_batch_id,
        'from_status', v_job.status,
        'to_status', p_status,
        'result_url', p_result_url
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'batch_job_id', v_job.id,
    'status', p_status,
    'completed_at', v_completed_at,
    'changed', p_status != v_job.status
  );
END;
$$;

COMMENT ON FUNCTION public.update_batch_job_status(text, text, text, text, numeric, int, int) IS
  'Transition a batch job status (used by WF_BATCH_POLLER). Records last_polled_at; '
  'audits status changes.';

REVOKE ALL ON FUNCTION public.update_batch_job_status(text, text, text, text, numeric, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_batch_job_status(text, text, text, text, numeric, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_batch_job_status(text, text, text, text, numeric, int, int) TO service_role;

-- ── fn_get_rag_run_detail — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/fn_get_rag_run_detail.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- ============================================================================
-- Source of Truth: fn_get_rag_run_detail
-- Popis: Detail view for a single rag_eval_runs row joined with its
--        rag_eval_golden source. Used by admin drill-down (future step) and
--        regression debugging (which run scored 0.4 on faithfulness?).
--
-- Step:  Step 0 of retrieval optimization plan 2026
-- Bezpečnost: SECURITY DEFINER + admin-or-staff (or service_role)
-- Audit:  N/A — read-only single-row lookup, no audit row to avoid log spam
-- Source migration: aisha/db/migrations/20260518200000_rag_eval_foundation.sql
-- ============================================================================

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.fn_get_rag_run_detail(uuid);

CREATE OR REPLACE FUNCTION public.fn_get_rag_run_detail(p_run_id uuid)
RETURNS TABLE (
  run_id                  uuid,
  golden_id               uuid,
  golden_slug             text,
  question                text,
  ground_truth_answer     text,
  generated_answer        text,
  context_profile_slug    text,
  embedding_model         text,
  llm_model               text,
  retrieved_chunk_ids     uuid[],
  faithfulness_score      numeric,
  answer_relevancy_score  numeric,
  context_precision_score numeric,
  context_recall_score    numeric,
  composite_score         numeric,
  latency_ms              integer,
  cost                numeric,
  metadata                jsonb,
  created_at              timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;
  IF NOT (public.is_admin_or_staff(auth.uid()) OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'Admin/staff or service_role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id, g.id, g.slug, g.question, g.ground_truth_answer, r.generated_answer,
    r.context_profile_slug, r.embedding_model, r.llm_model, r.retrieved_chunk_ids,
    r.faithfulness_score, r.answer_relevancy_score,
    r.context_precision_score, r.context_recall_score, r.composite_score,
    r.latency_ms, r.cost, r.metadata, r.created_at
  FROM public.rag_eval_runs r
  JOIN public.rag_eval_golden g ON g.id = r.golden_id
  WHERE r.id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_rag_run_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_rag_run_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_rag_run_detail(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_get_rag_run_detail(uuid) IS
  'Detail view for a single eval run: golden question + generated answer + all 4 scores + chunk IDs.';

-- ── get_subscription_packages — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/get_subscription_packages.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- Function: public.get_subscription_packages
-- Arguments: p_locale text (default 'en')
-- Description: Returns active subscription packages with localized name/description.
-- Security: SECURITY DEFINER - public read-only pricing data.
-- @security: public
-- @audit: none

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.get_subscription_packages(text);

CREATE OR REPLACE FUNCTION public.get_subscription_packages(p_locale text DEFAULT 'en')
 RETURNS TABLE(allow_one_time_payment boolean, allow_recurring_payment boolean, billing_interval_months integer, currency text, description text, governance_tokens integer, id uuid, impact_tokens integer, includes_diagnostics text[], includes_products text[], is_active boolean, is_recurring boolean, min_billing_months integer, name text, period text, price numeric, slug text, sort_order integer, stripe_price_id text, stripe_price_id_one_time text, stripe_price_id_recurring text, stripe_product_id text, tier text, tokens_governance integer, tokens_impact integer, tokens_data integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(sp.allow_one_time_payment, false) AS allow_one_time_payment,
    COALESCE(sp.allow_recurring_payment, COALESCE(sp.is_recurring, false)) AS allow_recurring_payment,
    sp.billing_interval_months,
    sp.currency,
    -- Localized description with fallback
    public.get_translation_value_with_fallback(
      sp.description_key,
      'subscription_packages',
      p_locale,
      'en',
      sp.description
    ) AS description,
    COALESCE(sp.governance_tokens, 0) AS governance_tokens,
    sp.id,
    COALESCE(sp.impact_tokens, 0) AS impact_tokens,
    sp.includes_diagnostics,
    sp.includes_products,
    COALESCE(sp.is_active, true) AS is_active,
    COALESCE(sp.is_recurring, false) AS is_recurring,
    COALESCE(sp.min_billing_months, 1) AS min_billing_months,
    -- Localized name with fallback
    public.get_translation_value_with_fallback(
      sp.name_key,
      'subscription_packages',
      p_locale,
      'en',
      sp.name
    ) AS name,
    sp.period::text,
    sp.price,
    sp.slug,
    COALESCE(sp.sort_order, 0) AS sort_order,
    sp.stripe_price_id,
    sp.stripe_price_id_one_time,
    sp.stripe_price_id_recurring,
    sp.stripe_product_id,
    sp.tier::text,
    sp.tokens_governance,
    sp.tokens_impact,
    sp.tokens_data
  FROM public.subscription_packages sp
  WHERE COALESCE(sp.is_active, true) = true
  ORDER BY COALESCE(sp.sort_order, 0);
END;
$function$
;

-- Permissions (public access for pricing page)
REVOKE ALL ON FUNCTION public.get_subscription_packages(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subscription_packages(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_subscription_packages(text) TO authenticated;

-- ── get_subscription_packages_admin — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/get_subscription_packages_admin.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- Function: public.get_subscription_packages_admin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:38+01:00

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.get_subscription_packages_admin();

CREATE OR REPLACE FUNCTION public.get_subscription_packages_admin()
 RETURNS TABLE(created_at timestamptz, currency text, description text, governance_tokens integer, id uuid, impact_tokens integer, is_active boolean, is_recurring boolean, name text, period text, price numeric, slug text, sort_order integer, stripe_price_id text, tier text, tokens_governance integer, tokens_impact integer, tokens_data integer, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;


  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'read'::public.journal_action_type,
      p_area := 'subscriptions'::public.journal_area,
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'subscription_package',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice'::public.journal_severity,
      p_summary := 'Admin read subscription package',
      p_tags := ARRAY['admin', 'subscription_package'],
      p_user_id := auth.uid()
  );

  RETURN QUERY
  SELECT
    sp.created_at,
    COALESCE(sp.currency, public.commerce_base_currency()) AS currency,
    COALESCE(sp.description, '') AS description,
    COALESCE(sp.governance_tokens, 0) AS governance_tokens,
    sp.id,
    COALESCE(sp.impact_tokens, 0) AS impact_tokens,
    COALESCE(sp.is_active, true) AS is_active,
    COALESCE(sp.is_recurring, false) AS is_recurring,
    sp.name,
    sp.period::text,
    sp.price,
    sp.slug,
    COALESCE(sp.sort_order, 0) AS sort_order,
    COALESCE(sp.stripe_price_id, '') AS stripe_price_id,
    sp.tier::text,
    sp.tokens_governance,
    sp.tokens_impact,
    sp.tokens_data,
    sp.updated_at
  FROM public.subscription_packages sp
  ORDER BY COALESCE(sp.sort_order, 0), sp.name;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_subscription_packages_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subscription_packages_admin() TO authenticated;

-- ── kanban_stories_view — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/kanban_stories_view.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- Function: public.kanban_stories_view
-- Description: Drives the mission-control kanban (`/admin/mission-control/kanban`).
--   Returns one row per visible story, joined with:
--     - workflow_statuses (swimlane label, sort order, color, is_terminal)
--     - latest ai_runs row (current_agent_slug, current_run_status)
--     - latest ai_trace_event timestamp (last_event_at)
--     - per-story AI cost aggregate (cost_to_date, tokens_to_date) over ai_runs
--     - per-story budget cap (ai_budget scope_type='story') → limit / consumed / state
--   Visibility:
--     - Admin/staff: every story
--     - Otherwise: participant stories ∪ stack-default singleton
--   The query is intentionally read-only — drag-drop mutations go through
--   update_story_status_audited (transition graph in workflow_status_transitions).
-- Security: SECURITY DEFINER. Authorization performed inline (mirrors
--   get_story_detail_audited's admin-or-participant pattern).
-- See also: workflow_statuses, workflow_status_transitions,
--   update_story_status_audited, ai_budget, useKanbanBoard hook.

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.kanban_stories_view(uuid);

CREATE OR REPLACE FUNCTION public.kanban_stories_view(
  p_partner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  story_id              uuid,
  partner_id            uuid,
  user_id               uuid,
  is_stack_default      boolean,
  title                 text,
  status                text,
  status_label_i18n_key text,
  status_sort_order     int,
  status_swimlane_color text,
  status_is_terminal    boolean,
  priority              text,
  is_starred            boolean,
  last_activity_at      timestamptz,
  default_branch        text,
  latest_run_id         uuid,
  current_agent_slug    text,
  current_run_status    text,
  last_event_at         timestamptz,
  cost_to_date      numeric,
  tokens_to_date        bigint,
  budget_cost_limit numeric,
  budget_consumed   numeric,
  budget_state          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  RETURN QUERY
  WITH visible_stories AS (
    SELECT ps.*
    FROM public.partner_stories ps
    WHERE
      (p_partner_id IS NULL OR ps.partner_id = p_partner_id)
      AND (
        v_is_admin
        OR ps.is_stack_default = true
        OR EXISTS (
          SELECT 1 FROM public.story_participants sp
          WHERE sp.story_id = ps.id AND sp.user_id = v_user_id
        )
      )
  ),
  latest_runs AS (
    SELECT DISTINCT ON (ar.story_id)
      ar.story_id,
      ar.id        AS run_id,
      ar.status    AS run_status,
      COALESCE(
        ar.route_plan -> 'agents' -> 0 ->> 'slug',
        ar.metadata ->> 'agent_slug',
        ar.kind
      ) AS agent_slug,
      ar.started_at,
      ar.finished_at
    FROM public.ai_runs ar
    WHERE ar.story_id IS NOT NULL
      AND ar.story_id IN (SELECT id FROM visible_stories)
    ORDER BY ar.story_id, ar.started_at DESC
  ),
  cost_agg AS (
    -- Per-story AI spend to date, aggregated over the canonical
    -- ai_runs.cost_total_json = { total, tokens_input, tokens_output }.
    SELECT
      ar.story_id,
      COALESCE(SUM(NULLIF(ar.cost_total_json->>'total', '')::numeric), 0) AS cost_to_date,
      -- SUM() over bigint operands returns numeric; the RETURNS TABLE column
      -- is declared bigint, so cast back explicitly or the function raises
      -- 42804 (numeric vs bigint) for every caller. See also final projection.
      COALESCE(SUM(
        COALESCE(NULLIF(ar.cost_total_json->>'tokens_input',  '')::bigint, 0) +
        COALESCE(NULLIF(ar.cost_total_json->>'tokens_output', '')::bigint, 0)
      ), 0)::bigint AS tokens_to_date
    FROM public.ai_runs ar
    WHERE ar.story_id IS NOT NULL
      AND ar.story_id IN (SELECT id FROM visible_stories)
    GROUP BY ar.story_id
  ),
  latest_events AS (
    SELECT lr.story_id, MAX(ate.created_at) AS last_event_at
    FROM latest_runs lr
    LEFT JOIN public.ai_trace_events ate ON ate.run_id = lr.run_id
    GROUP BY lr.story_id
  )
  SELECT
    vs.id                                       AS story_id,
    vs.partner_id,
    vs.user_id,
    vs.is_stack_default,
    vs.title,
    vs.status,
    ws.label_i18n_key                           AS status_label_i18n_key,
    ws.sort_order                               AS status_sort_order,
    ws.swimlane_color                           AS status_swimlane_color,
    COALESCE(ws.is_terminal, false)             AS status_is_terminal,
    vs.priority,
    vs.is_starred,
    vs.last_activity_at,
    vs.default_branch,
    lr.run_id                                   AS latest_run_id,
    lr.agent_slug                               AS current_agent_slug,
    lr.run_status                               AS current_run_status,
    le.last_event_at,
    COALESCE(ca.cost_to_date, 0)            AS cost_to_date,
    COALESCE(ca.tokens_to_date, 0)::bigint      AS tokens_to_date,
    ab.cost_limit                           AS budget_cost_limit,
    ab.consumed_cost                        AS budget_consumed,
    CASE
      WHEN ab.id IS NULL THEN NULL
      WHEN (ab.cost_limit IS NOT NULL AND ab.cost_limit > 0
            AND ab.consumed_cost / ab.cost_limit >= 1)
        OR (ab.token_limit IS NOT NULL AND ab.token_limit > 0
            AND ab.consumed_tokens::numeric / ab.token_limit >= 1)
        THEN 'stopped'
      WHEN (ab.cost_limit IS NOT NULL AND ab.cost_limit > 0
            AND ab.consumed_cost / ab.cost_limit >= 0.8)
        OR (ab.token_limit IS NOT NULL AND ab.token_limit > 0
            AND ab.consumed_tokens::numeric / ab.token_limit >= 0.8)
        THEN 'approaching'
      ELSE 'ok'
    END                                         AS budget_state
  FROM visible_stories vs
  LEFT JOIN public.workflow_statuses ws ON ws.status = vs.status
  LEFT JOIN latest_runs lr              ON lr.story_id = vs.id
  LEFT JOIN latest_events le            ON le.story_id = vs.id
  LEFT JOIN cost_agg ca                 ON ca.story_id = vs.id
  LEFT JOIN public.ai_budget ab         ON ab.scope_type = 'story'
                                       AND ab.scope_id = vs.id
                                       AND ab.period = 'lifetime'
  ORDER BY
    -- Stack-default first (pinned lane), then by sort_order, then by recency.
    vs.is_stack_default DESC,
    COALESCE(ws.sort_order, 9999) ASC,
    vs.last_activity_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.kanban_stories_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kanban_stories_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kanban_stories_view(uuid) TO service_role;

-- ── story_timeline — refreshed on upgrade (currency-suffix parameter rename)
-- Mirrored verbatim from aisha/db/sql/functions/story_timeline.sql so an EXISTING
-- database receives the renamed signature; the baseline alone never reaches one.
-- Function: public.story_timeline
-- Description: Unified chronological feed for one story — what AISHA + the
--   deploy pipeline have been doing. UNIONs three sources:
--     1. ai_trace_events for the story's ai_runs (LLM calls, tool calls,
--        patches, route decisions, critic reviews, escalations, etc.)
--     2. rollback_history rows whose app_name matches one of the story's
--        coolify_app_slots
--     3. Synthetic 'bg_switch' rows from coolify_app_slots.last_switch_at
--        for the story's apps
-- Security: SECURITY DEFINER. Admin/staff see all; otherwise the caller
--   must be a story_participants member (matches kanban_stories_view +
--   get_story_rulesets pattern).
-- See also: ai_trace_events (table), rollback_history (table),
--   coolify_app_slots (table), useStoryTimeline (UI hook).

-- A currency-suffixed name (`*_usd`) was removed from this function's signature.
-- The TYPES did not change, so CREATE OR REPLACE matches the deployed function and
-- Postgres refuses to rename in place ("cannot change name of input parameter", or
-- "cannot change return type" when the renamed name is a RETURNS TABLE column).
-- DROP-first is the convention used elsewhere in this directory; the REVOKE/GRANT
-- below re-applies whatever privileges the drop clears.
DROP FUNCTION IF EXISTS public.story_timeline(uuid, integer);

CREATE OR REPLACE FUNCTION public.story_timeline(
  p_story_id uuid,
  p_limit    int DEFAULT 50
)
RETURNS TABLE (
  event_id        uuid,
  event_kind      text,       -- 'trace' | 'rollback' | 'bg_switch'
  trace_event_type text,      -- ai_event_type::text (NULL for non-trace)
  ts              timestamptz,
  agent_slug      text,
  operation       text,
  status          text,
  duration_ms     int,
  cost        numeric,
  story_id        uuid,
  run_id          uuid,
  app_name        text,
  files_changed   text[],
  payload         jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_user_id IS NULL
     AND (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_admin_or_staff(v_user_id);

  -- Authorization: admin/staff OR participant OR stack-default story.
  IF NOT v_is_admin
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_stories ps
       WHERE ps.id = p_story_id
         AND (
           ps.is_stack_default = true
           OR EXISTS (
             SELECT 1 FROM public.story_participants sp
             WHERE sp.story_id = ps.id AND sp.user_id = v_user_id
           )
         )
     )
  THEN
    RAISE EXCEPTION 'Access denied: story participant or admin/staff required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH story_runs AS (
    SELECT ar.id AS run_id
    FROM public.ai_runs ar
    WHERE ar.story_id = p_story_id
  ),
  story_apps AS (
    SELECT cs.app_name, cs.last_switch_at, cs.active_slot,
           cs.blue_image_tag, cs.green_image_tag
    FROM public.coolify_app_slots cs
    WHERE cs.story_id = p_story_id
  ),
  trace_rows AS (
    SELECT
      ate.id                       AS event_id,
      'trace'::text                AS event_kind,
      ate.event_type::text         AS trace_event_type,
      ate.created_at               AS ts,
      ate.agent_slug,
      ate.operation,
      ate.status,
      ate.duration_ms,
      NULLIF(ate.cost_json ->> 'total', '')::numeric AS cost,
      p_story_id                   AS story_id,
      ate.run_id,
      NULL::text                   AS app_name,
      CASE
        WHEN ate.event_type = 'patch_applied'
             AND jsonb_typeof(ate.response_summary -> 'files') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(ate.response_summary -> 'files'))
        ELSE NULL
      END                          AS files_changed,
      jsonb_strip_nulls(jsonb_build_object(
        'provider',         ate.provider,
        'request_summary',  ate.request_summary,
        'response_summary', ate.response_summary,
        'error',            ate.error_json
      ))                           AS payload
    FROM public.ai_trace_events ate
    WHERE ate.run_id IN (SELECT run_id FROM story_runs)
  ),
  rollback_rows AS (
    SELECT
      rh.id                        AS event_id,
      'rollback'::text             AS event_kind,
      NULL::text                   AS trace_event_type,
      rh.triggered_at              AS ts,
      NULL::text                   AS agent_slug,
      format('rollback %s→%s', rh.from_slot, rh.to_slot) AS operation,
      COALESCE(rh.execution_status, rh.approval_status)   AS status,
      NULL::int                    AS duration_ms,
      NULL::numeric                AS cost,
      p_story_id                   AS story_id,
      NULL::uuid                   AS run_id,
      rh.app_name,
      NULL::text[]                 AS files_changed,
      jsonb_strip_nulls(jsonb_build_object(
        'from_slot',         rh.from_slot,
        'to_slot',           rh.to_slot,
        'from_image_tag',    rh.from_image_tag,
        'to_image_tag',      rh.to_image_tag,
        'triggered_by',      rh.triggered_by,
        'approval_status',   rh.approval_status,
        'execution_status',  rh.execution_status,
        'sentry_correlation', rh.sentry_correlation
      ))                           AS payload
    FROM public.rollback_history rh
    WHERE rh.app_name IN (SELECT app_name FROM story_apps)
  ),
  bg_switch_rows AS (
    SELECT
      gen_random_uuid()            AS event_id,
      'bg_switch'::text            AS event_kind,
      NULL::text                   AS trace_event_type,
      sa.last_switch_at            AS ts,
      NULL::text                   AS agent_slug,
      format('B/G switch → %s', sa.active_slot) AS operation,
      'succeeded'::text            AS status,
      NULL::int                    AS duration_ms,
      NULL::numeric                AS cost,
      p_story_id                   AS story_id,
      NULL::uuid                   AS run_id,
      sa.app_name,
      NULL::text[]                 AS files_changed,
      jsonb_build_object(
        'active_slot',      sa.active_slot,
        'blue_image_tag',   sa.blue_image_tag,
        'green_image_tag',  sa.green_image_tag
      )                            AS payload
    FROM story_apps sa
    WHERE sa.last_switch_at IS NOT NULL
  )
  SELECT * FROM (
    SELECT * FROM trace_rows
    UNION ALL
    SELECT * FROM rollback_rows
    UNION ALL
    SELECT * FROM bg_switch_rows
  ) merged
  ORDER BY ts DESC NULLS LAST
  LIMIT LEAST(p_limit, 500);
END;
$$;

REVOKE ALL ON FUNCTION public.story_timeline(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.story_timeline(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.story_timeline(uuid, int) TO service_role;

-- ============================================================================
-- li_* evidence silo — read surface reachable on an EXISTING database
--
-- WHY HERE AND NOT ONLY IN THE BASELINE: both halves below already exist as
-- sources (aisha/db/sql/functions/, aisha/db/sql/policies/, added 2026-07-16)
-- and the generator folds them into the baseline. But the baseline is applied
-- ONCE; on a database that already has a schema, migrate.mjs takes the
-- adopt-baseline branch (markApplied without executing), so anything added to
-- the baseline AFTER that database was created never arrives. Measured on the
-- live instance 2026-07-21: all five li_* tables held their rows (101 documents,
-- 348 obligations) while pg_proc had none of these functions and pg_policies had
-- none of these policies. heals.sql is the only path that reaches such a
-- database — a forward migration is refused by the baseline-only-release gate.
--
-- POLICIES FIRST, on purpose. The five surface RPC are deliberately SECURITY
-- INVOKER and delegate visibility to RLS (see the header of
-- get_document_register.sql). The tables ship with RLS ENABLED and — until these
-- policies land — ZERO policies, which in Postgres denies every row to every
-- non-bypassing role. Shipping the functions without the policies therefore
-- reproduces the exact live symptom: the RPC resolves and returns an empty set,
-- a green probe over no data. The gate is public.is_admin_or_staff(), the SAME
-- check the SECURITY DEFINER half (li_list_documents, li_get_document, …)
-- already raises in-function, so both halves now answer to one rule.
--
-- READ-ONLY by construction; this can only ever GRANT, never revoke:
--   * ingest writes as service_role, which carries rolbypassrls (verified live)
--     — the drop lane is unaffected either way;
--   * human review writes through submit_evidence_review_audited (SECURITY
--     DEFINER, reviewer-gated); direct INSERT/UPDATE stays denied as before.
--
-- All included files are idempotent by their own construction (DROP POLICY IF
-- EXISTS + CREATE POLICY; CREATE OR REPLACE FUNCTION), so re-running is a no-op.
-- ============================================================================

-- 2026-07-30: sloučené čtecí policies (predikát nároku do InitPlanu, ne per řádek).
-- Nahradily li_source_registry_admin_select + _member_tier_select + _read_admin a
-- li_obligations_admin_select + _read_admin; dropy starých jmen (včetně dvou, která
-- žila JEN v produkci a v SoT nikdy nebyla) jsou uvnitř těchto souborů.
-- 2026-09-10: strukturální člen čtecí policy jde přes definer (kroky mají admin-only RLS,
-- inline poddotaz pod rolí volajícího dával 0 řádků). Funkce MUSÍ být před policy.
\ir sql/functions/li_doc_slugs_claimed_by.sql
-- ⛔ PŘEDPOKLADY KOLA 10d PŘED PRVNÍM PŘEHRÁNÍM POLITIK (naměřeno 2026-09-28, pád
-- migrate na produkci). Politiky a funkce níž (li_source_registry_read tady,
-- surface_sections + list_surface_sections, twin_*_read) se v chronologii přehrávají
-- DŘÍV než bloky kola 10d na konci, a jejich dnešní SoT už volá funkce nároku z vazeb
-- a sondu přítomnosti. Na EXISTUJÍCÍ DB tehdy ještě nebyly: `DROP POLICY
-- li_source_registry_read` prošel, `CREATE POLICY` spadl („li_doc_slugs_v_rozsahu(uuid)
-- does not exist"), migrate skončil exit 1 a registr zůstal BEZ čtecí politiky.
-- Cold start to nechytí — baseline nese všechno najednou; chytí to jen upgrade
-- z předchozího mainu. Tabulky a funkce proto tady (vše idempotentní), plné bloky
-- s triggery a přestavbou zůstávají na konci.
\ir sql/tables/twin_scope_doc_rules.sql
\ir sql/tables/li_doc_scope_keys.sql
\ir sql/tables/surface_section_grants.sql
\ir sql/tables/data_source_grants.sql
\ir sql/functions/ma_plny_pristup_k_datum.sql
\ir sql/functions/ma_zdroj_dat.sql
\ir sql/functions/li_doc_scope_keys_z_dokladu.sql
\ir sql/functions/li_doc_slugs_v_rozsahu.sql
\ir sql/functions/twin_ids_v_rozsahu.sql
\ir sql/functions/surface_presence_ok.sql
\ir sql/policies/li_source_registry_read.sql
\ir sql/policies/li_source_registry_service_all.sql
\ir sql/policies/li_obligations_read.sql
\ir sql/policies/li_obligations_service_all.sql
\ir sql/policies/li_findings_admin_select.sql
\ir sql/policies/li_findings_service_all.sql
\ir sql/policies/li_links_admin_select.sql
\ir sql/policies/li_links_service_all.sql
\ir sql/policies/li_entity_suggestions_admin_select.sql
\ir sql/policies/li_entity_suggestions_service_all.sql

-- 2026-07-31: návrhy sjednocení identit — DVĚ vady na jedné dráze.
--
-- 1) CHECK znal jen dva druhy návrhu, ingest jich vydává čtyři. V produkci byl
--    rozšířen RUKOU (DB povolovala čtyři, SoT dva), takže cold-start by tu
--    vlastnost tiše ztratil a `similar_values_may_merge` by přestal projít.
-- 2) `li_upsert_entity_suggestions` NEBYLA v heals — žila jen v baseline, tedy
--    se na EXISTUJÍCÍ databázi nikdy nepřehrála. Oprava dedup klíče uvnitř by
--    dosedla jen na čerstvou DB a produkce by běžela dál na staré verzi.
-- 3) 2026-08-03: výčet PADL NATŘETÍ. Ingest vydal pátý druh
--    (`value_shape_foreign_to_field`) a čtyřprvkový CHECK odmítl CELÝ balíček
--    44 320 dokladů — jediný řádek zastavil replay evidence i KB (fail-closed
--    je správně, vadný byl kontrakt). Výčet nahrazen TVAREM: neprázdný slug.
--    Reconcile tu musí být, protože CREATE TABLE IF NOT EXISTS constraint na
--    běžící DB NEZMĚNÍ — bez tohoto řádku by oprava dosedla jen na čerstvou DB.
ALTER TABLE public.li_entity_suggestions
  DROP CONSTRAINT IF EXISTS li_entity_suggestions_suggestion_check;
ALTER TABLE public.li_entity_suggestions
  ADD CONSTRAINT li_entity_suggestions_suggestion_check
  CHECK (suggestion ~ '^[a-z][a-z0-9_]{2,63}$');
\ir sql/functions/li_upsert_entity_suggestions.sql

-- ── Story vzniká z VAZEB, ne z konfigurace (2026-08-30) ──────────────────────
-- Engine razítkoval do každého řádku `impl.json → story_id`, tedy UUID vypsané
-- do konfigurace. Naměřeno: 3 822 řádků mířilo na story, která má v DB nula
-- řádků. Kořen se nově RESOLVUJE z identity zdroje — věc, o které story je, si
-- ji drží (týž tvar jako `production_batches.story_id`).
--
-- Reconcile tu MUSÍ být: `CREATE TABLE IF NOT EXISTS` na běžící DB sloupec
-- nepřidá, takže bez těchto řádků by změna dosedla jen na čerstvou databázi.
ALTER TABLE public.agent_knowledge_sources ADD COLUMN IF NOT EXISTS story_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_knowledge_sources_story_id_fkey'
  ) THEN
    ALTER TABLE public.agent_knowledge_sources
      ADD CONSTRAINT agent_knowledge_sources_story_id_fkey
      FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE SET NULL;
  END IF;
END $$;
\ir sql/functions/ensure_source_story.sql
-- Bloky administrace ingestu: karanténa a registr zdrojů. Bez `\ir` by
-- funkce žily jen v baseline a na běžící databázi by nikdy nevznikly.
\ir sql/functions/get_ingest_karantena.sql
\ir sql/functions/get_ingest_zdroje.sql

-- ─── 2026-08-02 twinsverse osa B: hrany s platností ──────────────────────────
-- „Vše je twins" (majitel 2026-08-02): příslušnost, hierarchie i pověření jsou
-- HRANY nad twin substrátem s intervalem platnosti — ne sloupce na entitách.
-- Dnes vztah areál↔jednotka i nájemce žijí jako TEXTOVÉ parametry
-- (unit_site/unit_tenant) ⇒ dotaz na jednotku vrací agregát celku (blok E)
-- a nárok člena nejde odvodit (admin 64 653 dokladů / člen 0). Hrany jsou
-- substrát pro derive_audience (publikum · auditorium · elektorát) K DATU.
--
-- ⛔ PŘESUNUTO 2026-09-28 (dřív ř. 9049, ZA svými spotřebiteli): get_twin_detail
-- a get_scope_options jsou LANGUAGE sql, takže Postgres jejich tělo validuje už
-- při CREATE — a obě čtou twin_relations. Na DB z doby před 2. 8. (baseline
-- tabulku ještě neměl) proto migrate spadl dřív, než k tabulce došel:
-- `get_twin_detail.sql:160: relation "public.twin_relations" does not exist`
-- (instance s DB z července, core dole od 2026-09-26). Na čerstvé i průběžně migrované DB je
-- tabulka z baseline už před heals, proto to nikdo neviděl.
-- Blok proto stojí PŘED prvním spotřebitelem a tabulka i trigger jdou ze SoT
-- (jeden domov; inline kopie byla s SoT shodná, SoT navíc nese COMMENTy).
-- Vše, na čem blok sám stojí, na staré DB je: twin_entities (baseline od 17. 7.),
-- btree_gist (substrát), update_updated_at_column, is_admin_or_staff (baseline),
-- get_jwt_role a write_audit_journal (heals výš). Pořadí v obou směrech hlídá
-- brána heals-definice-pred-pouzitim.
\ir sql/tables/twin_relations.sql
\ir sql/indexes/idx_twin_relations_source_kind.sql
\ir sql/indexes/idx_twin_relations_target_kind.sql
\ir sql/indexes/idx_twin_relations_target_range.sql
\ir sql/triggers/twin_relations_updated_at.sql
\ir sql/policies/twin_relations_read.sql
\ir sql/functions/twin_relation_open_admin.sql
\ir sql/functions/twin_relation_close_admin.sql

-- Vazby konečně dopadnou: engine oba artefakty vyráběl a driver je NEČETL
-- (graph_nodes 0, graph_edges 0 při 345 odvozených vztazích).
\ir sql/tables/li_relation_suggestions.sql
-- Trigger jde přes baseline, ale heals musí dosáhnout i na BĚŽÍCÍ databázi:
-- tam by `\ir` tabulky vytvořil tabulku BEZ triggeru. `updated_at` sice
-- nastavuje i RPC explicitně, ale ruční UPDATE by ho jinak minul.
DROP TRIGGER IF EXISTS update_li_relation_suggestions_updated_at ON public.li_relation_suggestions;
\ir sql/triggers/update_li_relation_suggestions_updated_at.sql
-- Perioda přibyla až po prvním zavedení tabulky: `CREATE TABLE IF NOT EXISTS`
-- sloupec na běžící DB nedoplní.
ALTER TABLE public.li_relation_suggestions ADD COLUMN IF NOT EXISTS observed_from date;
ALTER TABLE public.li_relation_suggestions ADD COLUMN IF NOT EXISTS observed_to   date;
ALTER TABLE public.li_relation_suggestions ADD COLUMN IF NOT EXISTS time_axis     text;
\ir sql/indexes/idx_li_relation_suggestions_source.sql
\ir sql/indexes/idx_li_relation_suggestions_reach.sql
\ir sql/functions/li_upsert_relation_suggestions.sql

\ir sql/functions/li_list_documents.sql
\ir sql/functions/li_get_document.sql
\ir sql/functions/li_list_obligations.sql
\ir sql/functions/li_list_findings.sql
\ir sql/functions/li_list_links.sql
\ir sql/functions/li_list_entity_suggestions.sql
\ir sql/functions/submit_evidence_review_audited.sql
-- 2026-09-28 osa „podle firmy“: scope_applied je PŘEDPOKLAD deseti datových RPC, které se
-- přehrávají od tohoto místa dál (get_document_register, get_document_digest, …, LANGUAGE sql
-- validuje tělo při CREATE). Proto tady, před prvním z nich — ne na konci
-- (pád kola 10d: změněný soubor se tu přehraje dřív než nový předpoklad na konci).
\ir sql/functions/scope_applied.sql
\ir sql/functions/get_document_register.sql
\ir sql/functions/get_document_detail.sql
\ir sql/functions/get_twin_detail.sql
-- ⛔ Do 2026-08-31 tu CHYBĚLA, a to je celý důvod, proč se mobilní obrazovka
-- „Moje dodávky" po nasazení pořád nenačetla: funkce se změnila v SoT i
-- v baseline, jenže baseline se aplikuje jen na ČERSTVOU databázi. Běžící
-- produkce dál volala starou verzi (140 275 ms na prázdný výsledek).
-- Táž třída jako [[sot-funkce-bez-ir-v-heals-se-nenasadi]].
--
-- ⭐ Nová signatura je ŠIRŠÍ (p_days, p_limit, p_include_closed), takže
-- `CREATE OR REPLACE` starou verzi NEPŘEPÍŠE — vznikl by druhý přetížený
-- tvar a PostgREST by nevěděl, který volat. Proto se stará ruší výslovně.
DROP FUNCTION IF EXISTS public.get_my_workflow_steps(text);
\ir sql/functions/get_my_workflow_steps.sql
\ir sql/functions/reconcile_workflow_from_documents.sql
\ir sql/functions/get_document_digest.sql
\ir sql/functions/get_ingest_recap.sql
-- ⭐ NÁVRH ZLEPŠENÍ ZAKLÁDÁ JEN SLUŽBA NEBO SPRÁVA (2026-09-28, SELF_IMPROVEMENT_LOOP.md K-15).
-- Naměřeno na main 9087ef3df: fn_create_improvement_proposal byla SECURITY DEFINER s grantem
-- authenticated a bez stráže → každý přihlášený zakládal návrhy zlepšení libovolného agenta,
-- u plně autonomního s nízkým rizikem rovnou 'auto_approved'. Volají ji jen služba (n8n,
-- svc-agent-runner, fn_hermes_learning_loop, fn_record_proposal_outcome) a správcovské UI.
-- Funkce v heals nebyla — běžící DB držela verzi z cold startu.
\ir sql/functions/fn_create_improvement_proposal.sql
\ir sql/functions/get_obligation_queue.sql
\ir sql/functions/get_evidence_findings.sql

-- Úklidová dvojice k témuž silu: jeden řádek na jeden skutečný doklad
-- (li_dedupe_source_registry) a jeden KB záznam na týž doklad
-- (li_dedupe_knowledge_items). Obojí je operátorem volaná RPC s p_dry_run=true
-- jako výchozím stavem — heals je sem jen DORUČÍ, nespouští je.
\ir sql/functions/li_dedupe_source_registry.sql
\ir sql/functions/li_dedupe_knowledge_items.sql

-- PostgREST caches the schema; without this the functions above exist in
-- pg_proc but every call returns PGRST202/404. Measured 2026-07-21: this exact
-- symptom hid a fully working chain (the functions had been delivered
-- out-of-band, so no reload had fired).
NOTIFY pgrst, 'reload schema';

-- 07-25 vykostění porada/tenants bloků: stará per-doména jména nahrazena
-- generickými config-driven bloky (get_twin_events_table_block, get_twin_ref_*,
-- get_doc_expiry_review_block) + konfigurace v instance overlay. Idempotentní
-- úklid, aby KAŽDÉ prostředí konvergovalo (heals běží na každém migrate).
DROP FUNCTION IF EXISTS public.get_porada_activity(jsonb);
DROP FUNCTION IF EXISTS public.get_porada_pending(jsonb);
DROP FUNCTION IF EXISTS public.get_porada_review(jsonb);
DROP FUNCTION IF EXISTS public.get_porada_recommendations(jsonb);
DROP FUNCTION IF EXISTS public.get_object_tenants(jsonb);

-- ⚠ Ty generické bloky se sem NIKDY nedodaly — komentář výše je jmenuje, ale
-- `\ir` tu byl jen pro get_document_detail. Důsledek změřený 07-28: oprava
-- provenance v get_doc_expiry_review_block prošla do SoT i do baseline, ale na
-- ŽIVOU databázi se nedostala (heals běží na každém migrate, baseline ne), a
-- blok `pd_recommend` dál nesl `basis` v provenance → klient ho zahazoval celý.
-- Funkce v SoT bez `\ir` v heals se opraví jen cold startem, což na běžící
-- instanci nikdy nenastane.
\ir sql/functions/get_doc_expiry_review_block.sql
\ir sql/functions/get_twin_events_table_block.sql

-- ── obecné čtení veličin nad dvojčaty ────────────────────────────────────────
-- Kde veličina leží, říká KATALOG (`twin_parameter_definitions.metadata`), ne kód
-- čtečky: `twin_param_values` je jediné místo, které to ví. Nad ním jedna
-- agregace po dvojčatech a tři masky z uzavřeného katalogu. Díky tomu je nová
-- doména ŘÁDEK V KATALOGU, ne další šestice funkcí v jádře (ADR-003 §3).
\ir sql/functions/twin_param_values.sql
\ir sql/functions/twin_param_agg.sql
\ir sql/functions/get_twin_metric_kpi_block.sql
\ir sql/functions/get_twin_metric_chart_block.sql
\ir sql/functions/get_twin_metric_table_block.sql
-- 2026-09-03 (audit U4-5, U4-3): dispatcher vynucuje publikum jako hranici dat
-- a restricted bloky neberou parametry od klienta; nový generický timeline
-- blok nad publikovanými články. Bez `\ir` by se to na živou DB nedostalo.
\ir sql/functions/get_block_data.sql
\ir sql/functions/get_news_timeline_block.sql
\ir sql/functions/get_twin_ref_pending_block.sql
\ir sql/functions/get_twin_ref_review_block.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-26 extension spine: every plugin kind materializes ──────────────
-- The plugin control plane declared 6 kinds and wired 1 (agents). This wave
-- adds the materialization spine for the rest + the data_source kind, so
-- "approved manifest ⇒ resolver-visible registry row" holds for the whole
-- surface (expert_rule declared-extension-must-reach-the-resolver). Existing
-- DBs converge here; fresh DBs get all of it from the baseline.

-- New enum value (safe: ADD VALUE IF NOT EXISTS; consumers reference it only
-- at call time, never in a same-transaction cast of a freshly added value).
ALTER TYPE public.plugin_kind ADD VALUE IF NOT EXISTS 'data_source';

-- Per-kind materialization specs on the catalog (symmetric to agent_spec).
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS provider_spec jsonb;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS node_spec jsonb;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS auth_spec jsonb;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS tracking_spec jsonb;
ALTER TABLE public.plugin_catalog ADD COLUMN IF NOT EXISTS source_spec jsonb;

-- Ownership/provenance column on every materialization target (the guard that
-- lets a plugin update ONLY its own row — never overwrite a built-in).
ALTER TABLE public.ai_provider_registry ADD COLUMN IF NOT EXISTS source_plugin_id uuid REFERENCES public.plugin_catalog(id) ON DELETE SET NULL;
ALTER TABLE public.custom_node_registry ADD COLUMN IF NOT EXISTS source_plugin_id uuid REFERENCES public.plugin_catalog(id) ON DELETE SET NULL;
ALTER TABLE public.agent_knowledge_sources ADD COLUMN IF NOT EXISTS source_plugin_id uuid REFERENCES public.plugin_catalog(id) ON DELETE SET NULL;

-- New registries (materialization targets for auth_provider / web_tracking).
\ir sql/tables/auth_provider_registry.sql
\ir sql/tables/web_tracking_registry.sql
\ir sql/grants/auth_provider_registry.sql
\ir sql/grants/web_tracking_registry.sql
DROP POLICY IF EXISTS "auth_provider_registry_authenticated_read" ON public.auth_provider_registry;
\ir sql/policies/auth_provider_registry_authenticated_read.sql
DROP POLICY IF EXISTS "auth_provider_registry_service_all" ON public.auth_provider_registry;
\ir sql/policies/auth_provider_registry_service_all.sql
DROP POLICY IF EXISTS "web_tracking_registry_authenticated_read" ON public.web_tracking_registry;
\ir sql/policies/web_tracking_registry_authenticated_read.sql
DROP POLICY IF EXISTS "web_tracking_registry_service_all" ON public.web_tracking_registry;
\ir sql/policies/web_tracking_registry_service_all.sql

-- Materializers + dispatchers + consumer RPCs (CREATE OR REPLACE — idempotent).
\ir sql/functions/materialize_backend_provider.sql
\ir sql/functions/materialize_automation_node.sql
\ir sql/functions/materialize_auth_provider.sql
\ir sql/functions/materialize_web_tracking.sql
\ir sql/functions/materialize_data_source.sql
\ir sql/functions/materialize_plugin.sql
\ir sql/functions/deactivate_plugin_runtime.sql
\ir sql/functions/get_enabled_auth_providers.sql
\ir sql/functions/get_active_web_tracking.sql
-- Call sites now dispatch by kind (agents unchanged inside the dispatcher).
\ir sql/functions/transition_plugin_status.sql
\ir sql/functions/fn_aisha_kb_decision.sql
\ir sql/functions/review_moderation_item.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-27 function catch-up — the class this section exists for ────────
-- Post-baseline SoT functions reach FRESH DBs via the regenerated baseline but
-- an EXISTING DB only ever converges through this file. Nobody added these 12
-- when their features merged (#815 tc_*, #828 qualification/consents, today's
-- ai_runs default-story anchor), so the live instance answered "function does
-- not exist" while every gate was green against clean DBs. Measured live
-- 2026-07-27: 12 of 1568 SoT functions missing.
\ir sql/functions/is_qualified.sql
\ir sql/functions/start_test_attempt.sql
\ir sql/functions/submit_test_attempt.sql
\ir sql/functions/get_my_pending_consents.sql
\ir sql/functions/guard_partner_profile_privilege_columns.sql
\ir sql/functions/tc_list_sync_vehicle_ids.sql
\ir sql/functions/tc_record_import_audited.sql
\ir sql/functions/tc_upsert_drivers_audited.sql
\ir sql/functions/tc_upsert_groups_audited.sql
\ir sql/functions/tc_upsert_rides_audited.sql
\ir sql/functions/tc_upsert_vehicles_audited.sql
\ir sql/functions/fn_ai_runs_default_story.sql
\ir sql/triggers/ai_runs_default_story.sql
-- 2026-09-30: trigger pravidel experta nesmí volat hlídanou kotvu (story_id NULL → doplní
-- ai_runs_default_story výš). Bez tohoto řádku by oprava došla jen na nově založenou DB —
-- upgrade test z produkce (kolo 13) ukázal na riq starou definici s guardem.
\ir sql/functions/fn_notify_rule_change.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-27 surface = SEKCE, ne zařízení (otevřený text) ─────────────────
-- Uzavřený CHECK na surface dělal z backendu rukojmí klientského buildu: 'porada'
-- se do živé DB dostala ALTERem mimo SoT (repo znalo 3 hodnoty, DB 4) a snímek
-- pro ni nešlo podepsat vůbec. Nová sekce musí být ŘÁDEK, ne migrace.
-- Baseline to má správně; EXISTUJÍCÍ DB konverguje jen tudy. Idempotentní.
alter table public.surface_layouts   drop constraint if exists surface_layouts_surface_check;
alter table public.surface_snapshots drop constraint if exists surface_snapshots_surface_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.surface_layouts'::regclass and conname = 'surface_layouts_surface_nonempty'
  ) then
    alter table public.surface_layouts
      add constraint surface_layouts_surface_nonempty check (length(surface) > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.surface_snapshots'::regclass and conname = 'surface_snapshots_surface_nonempty'
  ) then
    alter table public.surface_snapshots
      add constraint surface_snapshots_surface_nonempty check (length(surface) > 0);
  end if;
end $$;

-- Deterministické pořadí bloků (tiebreak block_slug) — funkce je CREATE OR REPLACE,
-- existující DB ji dostane jen tudy.
\ir sql/functions/get_surface_layout.sql
\ir sql/functions/get_surface_layout_ui.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-27 chart do katalogu masky ─────────────────────────────────────
-- Maketa (finance, ops) stojí na ChartCard/TrendLine/HBar/Donut a katalog pro ně
-- neměl typ — dvě z pěti obrazovek extranetu neměly nosič vůbec. JEDEN typ
-- 'chart' s uzavřeným kind (trend|bar|donut): je to jeden renderer, ne tři.
-- Baseline to má; EXISTUJÍCÍ DB konverguje jen tudy. Rozšíření výčtu je bezpečné
-- (stará data zůstávají platná), ale MUSÍ dorazit dřív než řádek s block_type
-- 'chart' — proto tady, ne v instance overlay.
--
-- Constraint se sem ZÁMĚRNĚ nepíše: jeho jediný zapisovatel je blok níže
-- („katalog masky"), který drží ÚPLNÝ výčet. Dva bloky přehazující tentýž
-- constraint jsou táž chyba jako dva zapisovatelé rozvržení — první z nich
-- přidá užší výčet a padne na řádku, který zapsal ten druhý. Naměřeno naostro
-- 2026-07-28: migrate skončil `check constraint ... is violated by some row`,
-- protože tenhle blok přidával výčet bez 'timing_tower'.

-- ⚠️ 2026-07-29: list_surface_sections je LANGUAGE sql — tělo se validuje už
-- při CREATE, takže tabulky navigace musí existovat PŘED prvním \ir té funkce
-- (na běžící instanci to projde vždy, na ČISTÉ DB by to spadlo — čistá DB je
-- jediný důkaz). Proto šablona sekcí stojí tady, ne až u svého záznamu níž.
-- Obě: funkce slévá coalesce(override, šablona), takže odkazuje na obě tabulky.
-- Politiky/granty/triggery mají vlastní soubory a jdou AŽ NÍŽ — trigger volá
-- public.set_updated_at(), která tady ještě existovat nemusí.
\ir sql/tables/surface_sections.sql
\ir sql/tables/surface_section_overrides.sql

-- ─── 2026-07-27 list_surface_sections — sekce se objevují, ne zadrátovávají ──
-- Bez tohohle si každý shell zadrátoval jednu sekci (workbench-shell 'workbench'),
-- takže porada s 7 bloky a plnými daty neměla na webu KDO zobrazit. Sekce jsou
-- data → klient je musí objevit. Existující DB dostane funkci jen tudy.
\ir sql/functions/list_surface_sections.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-28 Mission Control — timing_tower ──────────────────────────────
-- Maska nad BĚHY relevantními pro pohled volajícího (ne globální žebříček).
-- Sektory chodí ze šablony procesu daného běhu, vlajka se odvozuje z OBECNÝCH
-- polí (status kroků), ne z doménových stavů — proto to přežije jinou doménu.
-- 2026-08-17 + 'handover_confirm': potvrzení úkonu v terénu (dodák, předání,
-- odečet) jako MASKA, ne obrazovka — o zobrazení rozhodují data (sekce), ne
-- router. Výčet tu drží JEDINÝ zapisovatel (viz varování výše — dva bloky nad
-- týmž constraintem = naměřený incident 2026-07-28); slovník je jinak odvozený:
-- types.ts nese BLOCK_TYPES as const, schemas.ts si ho importuje, tenhle CHECK
-- hlídá parity test packages/surface-blocks/test/block-type-parity.test.ts.
-- 2026-09-23 + 'relation_web' (síť vazeb, ESDK es-web — karta protistrany).
-- 2026-09-06 + 'action_form' (ADR-003 K4). NAMERENO V PROD 2026-09-06 01:03Z: K4 blok
-- niz pridal DRUHEHO zapisovatele tehoz constraintu (vlastni ALTER s novym vyctem).
-- Prvni nasazeni proslo (hook vlozil radek action_form AZ PO heals), druhe spadlo
-- presne tady: tenhle starsi ALTER se starym vyctem narazil na existujici radek
-- action_form -> migrate exit 1 -> stack bez gateway -> API 502. Proto zustava
-- JEDINY zapisovatel a novy typ se pridava SEM, ne novym blokem. Hlida
-- src/tests/db/heals-jediny-zapisovatel-masek.test.ts (pocet zapisovatelu +
-- opakovany beh heals nad radky vsech typu masek).
alter table public.surface_blocks drop constraint if exists surface_blocks_block_type_check;
alter table public.surface_blocks
  add constraint surface_blocks_block_type_check
  check (block_type in ('kpi_tile','chart','table','timeline','alert_feed','narrative',
                        'record_detail','review_queue','findings','goal_progress','timing_tower',
                        'handover_confirm','action_form','relation_web'));

-- ⚠️ 2026-08-05: get_batch_workflow_progress tu do dneška NEBYLA vůbec, přestože
-- ji SoT nese a věž na ní stojí. Změna v SoT souboru se proto na žádnou běžící
-- databázi nedostala — nasadilo by ji jen znovupostavení baseline. Zapojuje se
-- PŘED věží, která ji volá (pořadí tu není nutnost plpgsql, ale čitelnost:
-- producent před konzumentem).
\ir sql/functions/get_batch_workflow_progress.sql
\ir sql/functions/get_timing_tower_block.sql

-- ─── 2026-08-05 Fotografická evidence z terénu ──────────────────────────────
-- Jedna dráha pro předání dodáku i odečet měřidla: liší se entita, ne akvizice.
-- Snímek je informace K ENTITĚ, takže se registruje jako twin_events (append-only,
-- idempotence přes source_ref = object key); obrázek zůstává v MinIO.
\ir sql/functions/create_entity_evidence_preflight_audited.sql

-- ─── 2026-08-05 Odečet měřidla: hodnota jde S POTVRZENÍM ────────────────────
-- Přepis submit_meter_reading_audited. Předchozí verze zapisovala hodnotu jako
-- NÁVRH (`verification:'pending'`) na objekt/nájemce a autorizovala fakticky
-- kohokoli přihlášeného; nová ji zapisuje POTVRZENOU na twin MĚŘIDLA, nárok
-- bere z otevřeného úkolu a rovnou uzavírá milník. Soubor sám DROPuje starý
-- textový podpis — bez toho by vedle sebe žily dvě funkce téhož jména.
-- ⚠️ V heals do dneška NEBYLA vůbec, takže jakákoli její oprava se na běžící
-- databázi nedostala (týž případ jako get_batch_workflow_progress 08-05).
\ir sql/functions/submit_meter_reading_audited.sql

-- ⚠️ Starý TEXTOVÝ podpis pryč. `create or replace` s JINÝMI typy parametrů
-- nevytvoří novou verzi téže funkce, ale DRUHOU funkci vedle — a ta stará
-- zapisuje hodnotu jako NÁVRH (`verification:'pending'`) na objekt místo
-- potvrzené hodnoty na měřidlo. Bez tohohle DROPu by tedy přepis nic neopravil,
-- jen přidal druhou cestu.
--
-- Stojí to TADY, a ne v SoT souboru, schválně: SoT se přehrává při KAŽDÉM
-- migrate, takže by se DROP pokoušel provést pokaždé — a na běžící databázi na
-- funkci můžou viset policies/views („cannot drop function … because other
-- objects depend on it"). Tady je to jednorázový úklid v chronologii zásahů.
-- Hlídá to brána rls-predikat-a-indexy.
DROP FUNCTION IF EXISTS public.submit_meter_reading_audited(text, text, numeric, text, text, text, timestamptz);

-- ─── 2026-08-05 Dispečer otevře KONKRÉTNÍ krok — a vidí realitu ─────────────
-- Zadání majitele: „Chci si jako admin vybrat dodák a vidět ho tak, jak to je
-- v reálu — jaký má stav a čí je. A platí to úplně plošně."
--
-- Nárok na cizí kroky existoval od 07-30 (`workflow_step_visible_to`, rozsah
-- 'dispatch') a dispečerská fronta je UKAZOVALA — jenže otevřít je nešlo:
-- potvrzovací obrazovka čte `get_my_workflow_steps`, a ta je z principu osobní.
-- Chybělo ČTENÍ JEDNOHO KROKU s dispečerským rozsahem; tady je.
--
-- Zápis se nemění a nesmí: `complete_workflow_step` ukládá completed_by =
-- auth.uid(), takže i dispečerské potvrzení nese toho, kdo doopravdy klikl.
-- Pohled je plošný, identita v evidenci zůstává pravdivá.
\ir sql/functions/get_workflow_step_detail.sql

-- ─── 2026-08-05 Kalendář nad frontou: absolutní datum + stav 'any' ──────────
-- Zadání majitele: „Chtělo by to nějaký kalendář, kde si můžu vybrat, že chci
-- vidět něco k tomu datu."
--
-- Kalendář NENÍ druhá fronta, je to jiný filtr nad touž. Kanál pro parametry od
-- klienta existuje (`get_block_data` merguje source_params || p_params), chybělo
-- jen, aby fronta uměla ABSOLUTNÍ den — `due='today'` zná pouze okolí dneška.
--
-- Tři pravidla, všechna selhávají TICHÝM PRÁZDNEM (fronta se vykreslí a je
-- prázdná, což vypadá jako „ten den se nic nevezlo"):
--   · absolutní okno PŘEBÍJÍ relativní — jinak by blok s `due='today'`
--     v konfiguraci vrátil na každý jiný den nulu,
--   · `status='any'` — výchozí filtr je 'pending', jenže co bylo, je hotové,
--   · odchylka je 'failed', ne 'needs_review' — jinak by se na dni v minulosti
--     nabízela k odbavení věc, která už dopadla špatně.
-- Mutačně ověřeno sondou workflow-queue-kalendar (každá mutace shodí právě to
-- své tvrzení; bez okna se chování NEMĚNÍ — regrese řidičovy pásky).
\ir sql/functions/get_workflow_my_steps_block.sql

-- ─── 2026-08-05 „AISHA nás nasměruje na ten doklad" — KANÁL, pak přesný klíč ─
-- Zadání majitele: „dohledat to přes dotaz AIŠE, která by nás na ten list měla
-- nasměrovat" + „dodáky jí samozřejmě chceme dát taky, vše" + „multi twinverse".
--
-- Měřeno, ne odhadnuto: odpovídač rozřazuje záměr REGEXEM nad kmeny (nájmy,
-- energie, smlouvy, telematika) a dodák mezi nimi NENÍ; a hlavně odpověď nemá
-- kam dát CÍL — vrací tabulku odpoved|pokryti|zdroj. Nasměrování se tedy nedalo
-- vyjádřit, ať je klasifikace jakkoli dobrá.
--
-- Pořadí je proto obrácené oproti instinktu:
--   1. KANÁL — obálka bloku umí `target` {entity_kind, entity_id, label};
--      `entity_kind` je OTEVŘENÝ slug (twinverse: čím věci jsou, to jsou data),
--      na rozdíl od `block_type`, který pojmenovává renderer a je uzavřený.
--   2. PŘESNÝ KLÍČ — `resolve_entity_reference`: číslo dokladu není úloha pro
--      model, je to shoda. Které pole je identita, se čte z KATALOGU
--      (`twin_parameter_definitions.metadata->>'identity'`), takže v platformě
--      nestojí ani jedno instanční slovo a nový druh entity je ŘÁDEK.
--   3. fuzzy přes lokální model až potom — naplní týž kanál.
--
-- ⛔ Nejednoznačnost = ŽÁDNÝ výsledek (čísla dokladů se přes firmy opakují —
--    naměřeno 804 kolizí). ⚠️ `target` se posílá VÝHRADNĚ tomu, kdo o něj
--    požádal: Ajv je all-or-nothing a povrchy se nasazují jinou kadencí než
--    jádro, takže starý klient musí dostat bajtově tutéž obálku.
\ir sql/indexes/idx_pws_input_data_gin.sql
\ir sql/functions/resolve_entity_reference.sql
\ir sql/functions/get_answer_block.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-28 admin sekce — RPC, které allowlist sliboval a nebyly ─────────
-- 11 z 28 záznamů allowlistu ukazovalo na neexistující funkci. Sedm z nich byla
-- stará jména nahrazená jinými (živé bloky čtou get_twin_ref_*, get_answer_*) —
-- ta se NEIMPLEMENTUJÍ, byl by to duplikát fungující věci. Tyhle čtyři měly blok
-- a chyběla jim funkce: to je infrastruktura k dostavění, ne mrtvý kód.
-- Kde hodnoty nejsou, vrátí prázdno — prázdný nosič s provenancí je signál
-- „tahle data si vyžádat", ne důvod nosič nepostavit.
\ir sql/functions/get_answer_chain_metrics.sql
\ir sql/functions/get_answer_chain_trend.sql
\ir sql/functions/get_answer_chain_costs.sql
\ir sql/functions/get_answer_chain_runs.sql

-- Jména bez instance (2026-07-28). Ty čtyři funkce jsem den předtím pojmenoval
-- get_riq_*, což je instance v generickém SQL — a schéma dědí celý stack, takže
-- je to nejdražší místo, kde to udělat. Logika je obecná (provoz odpovídacího
-- řetězu nad ai_trace_events/ai_runs), tak se tak i jmenují.
--
-- Pořadí je dané cizím klíčem: surface_blocks.source_rpc → surface_data_rpcs.
-- Nová jména do allowlistu zapisuje instance overlay (46_admin_section.sql) a
-- teprve pak smí stará zmizet, jinak by DELETE narazil na FK ze živého bloku.
-- Proto se tu ruší JEN funkce; řádky allowlistu patří instanci.
-- ─── 2026-07-28 obnova dvou funkcí, které existovaly JEN v běžící databázi ───
-- get_answer_block a get_answer_coverage_block stály pod sekcí `ask`, vracely
-- v produkci HTTP 200 — a jejich definice nebyla v žádném repu. Cold start by
-- blok, řádek allowlistu i umístění vyrobil a pak zavolal funkci, kterou nikdo
-- nevytvořil. Vytaženo přes pg_get_functiondef ze živé DB a opraveno: obojí
-- porušovalo kontrakt obálky (provenance bez freshness_at/trace_id), takže je
-- klient CELÉ přeskakoval; coverage navíc nesl `context_profile_slug='riq'`
-- přímo v generickém SQL (teď z source_params bloku).
--
-- Naživo je to `create or replace` nad existující funkcí, tedy no-op; smysl má
-- pro COLD START, kde do teď chyběly.
\ir sql/functions/get_answer_block.sql
\ir sql/functions/get_answer_coverage_block.sql

drop function if exists public.get_riq_metrics(jsonb);
drop function if exists public.get_riq_trend(jsonb);
drop function if exists public.get_riq_case_costs(jsonb);
drop function if exists public.get_riq_test_run(jsonb);

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-28 sekce podle oprávnění + fronta milníků, která se vykresluje ───
-- Sloupec surface_layouts.audience existoval od začátku a NIKDO ho nečetl:
-- jediná policy pro authenticated měla v USING pouze `is_active = true`, takže
-- každý přihlášený dostal z list_surface_sections() VŠECHNY sekce včetně
-- 'admin'. Data bloku RLS ořeže, ale jména sekcí prosákla — a povrch, který má
-- člověku ukázat výhradně jeho práci, nesmí prozradit, co všechno existuje.
--
-- Pořadí je závazné: funkce MUSÍ existovat dřív, než ji policy zmíní, jinak
-- CREATE POLICY spadne na neznámou funkci.
\ir sql/functions/surface_audience_allows.sql
\ir sql/policies/surface_layouts_select_active.sql

-- Fronta milníků byla proti kontraktu review_queue a ve webovém shellu se TIŠE
-- nevykreslovala (chybělo entity_kind + actions, přebývalo status + reward;
-- Ajv blok odmítl a loadConsole ho zahodil s console.warn). Zároveň měla
-- neúčinný `limit` (stál za jsonb_agg bez GROUP BY) a neumožňovala se zeptat
-- „co mám dnes". Sloupce řádku teď deklaruje konfigurace bloku.
-- Sdílený predikát viditelnosti kroku. Do heals patří ze DVOU důvodů a oba se
-- projeví až na UŽ INICIALIZOVANÉ databázi, kde se baseline znovu neaplikuje:
--   1. rozšíření o `p_scope` (dispečerský pohled) by se na běžící instanci
--      nikdy neobjevilo — funkce, která rozhoduje KDO CO VIDÍ, by tam zůstala
--      ve staré podobě a `all_assignees` by tiše nedělal nic;
--   2. `CREATE OR REPLACE` neumí odstranit PŘEDCHOZÍ signaturu, takže by vedle
--      nové 5argumentové visela stará 4argumentová. PostgREST řeší RPC podle
--      JMEN argumentů → volání s `p_scope` skončí PGRST202 přesně na těch
--      instancích, které jsou nejdéle v provozu.
-- Musí předcházet volajícímu (`get_workflow_my_steps_block`).
DROP FUNCTION IF EXISTS public.workflow_step_visible_to(uuid,uuid,text,jsonb);
\ir sql/functions/workflow_step_visible_to.sql

\ir sql/functions/get_workflow_my_steps_block.sql
-- Časová osa uzlu. Bez `\ir` by změna zůstala v SoT a na nasazené DB by
-- funkce dál běžela ve staré podobě — přesně ta třída, kvůli které tenhle
-- soubor existuje. Doplněno při zavedení `row_kind` (2026-08-07).
\ir sql/functions/get_workflow_timeline_block.sql

-- Zápisová cesta fronty: web shell má jméno RPC zadrátované (a je to záměr —
-- data bloku nesmí volit zapisovatele), takže potvrzení milníku muselo projít
-- tímhle dispatcherem. Osa 'workflow_step' se NEautorizuje rolí recenzenta,
-- ale predikátem samotného milníku, který je pro tenhle případ striktnější.
--
-- Poloha milníku se ODVOZUJE (příjezdový signál → telematika), nikdy nepřichází
-- od klienta: souřadnice od toho, koho dokumentují, není důkaz.
\ir sql/functions/workflow_step_derived_position.sql

-- Dispatcher dostal p_evidence (jméno přebírajícího + podpis), takže se změnila
-- SIGNATURA. Bez tohohle DROPu by v běžící DB zůstaly oba tvary, oba by byly
-- vidět z PostgRESTu a volání by se rozhodovalo podle toho, které argumenty
-- klient zrovna poslal — tichý přepínač mezi „s důkazem" a „bez důkazu".
DROP FUNCTION IF EXISTS public.submit_evidence_review_audited(text, uuid, text, text);
\ir sql/functions/submit_evidence_review_audited.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-28 běh procesu se konečně má kdo otevřít ────────────────────────
-- Tři RPC, které běh potřebuje, existovaly, ale NIKDO je nevolal: batch bez
-- materializace nemá jediný krok a batch bez story spolkne celou naraci mlčky
-- (v complete_workflow_step je narace i goal re-evaluace pod `if story_id is
-- not null`). Chybějící sloveso, ne chybějící mašinerie.
--
-- Idempotence podle run_code je tu POVINNÁ, ne pohodlí: batch_code nemá unique
-- ani index, takže dvojí průchod téhož dokladu by tiše vyrobil dva běhy a dvě
-- sady kroků — a člověk by tutéž práci potvrzoval dvakrát. Díky tomu ji smí
-- volat i ten, kdo doklad přináší, bez přemýšlení, jestli už tudy šel.
\ir sql/functions/ensure_workflow_run_for_subject.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-29 navigace jako data: šablona + override, vše přes klíče ──────
-- Sekce dostaly skupinu, pořadí, ikonu a TŘETÍ STAV: 'inactive' — deklarovaná,
-- ale bez napojeného zdroje, v navigaci viditelná zašedle s důvodem. Dvě
-- vrstvy se dvěma vlastníky (šablona = overlay/deploy, override = admin RPC),
-- protože jedna tabulka se dvěma zapisovateli nekonverguje nikdy — přesně ta
-- třída, kvůli které kdysi rozvržení plodilo zombie řádky.
-- Jména jsou VÝHRADNĚ klíče do translations; administrace nikdy neukládá text.
--
-- Rozpad do složek NENÍ formalita: baseline emituje tables/ PŘED functions/,
-- takže trigger volající public.set_updated_at() smí přijít až z triggers/.
-- Naměřeno na ČISTÉ DB: baseline padl na `function public.set_updated_at()
-- does not exist`, protože triggery seděly natvrdo v souboru tabulky.
\ir sql/tables/surface_sections.sql
\ir sql/tables/surface_section_overrides.sql
\ir sql/policies/surface_sections_read.sql
\ir sql/policies/surface_section_overrides_read.sql
\ir sql/grants/surface_tables.sql
\ir sql/triggers/surface_sections_updated_at.sql
\ir sql/triggers/surface_section_overrides_updated_at.sql
\ir sql/functions/set_surface_section_override_admin.sql

-- list_surface_sections nově vrací sloučený tvar včetně 'inactive' sekcí.
-- Dřívější „prázdnou sekci zamlč" se tím VĚDOMĚ mění — viz komentář ve funkci.
\ir sql/functions/list_surface_sections.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-29 answer_verified_facts: záchrana do SoT + poctivost odpovědí ──
-- Funkce žila JEN v generované baseline a v živé DB — bez SoT, bez testů, bez
-- cesty k opravě. Naměřeno: „kolik je hodin?" dostalo přehled nájemců s coverage
-- FULL (catch-all ‚kolik'), „kdo platí nejmíň" dostal NEJVYŠŠÍ nájem (šablona
-- ignorovala otázku). Pomocníci před funkcí (plpgsql je volá za běhu).
\ir sql/functions/norm_text.sql
\ir sql/functions/fmt_num_cs.sql
-- ─── 2026-08-04: nájem se DERIVUJE, nečte ze seedu ───────────────────────────
-- `get_rent_current` musí být PŘED odpovídačem: plpgsql ho volá za běhu, a bez
-- něj by `answer_verified_facts` prošel vytvořením a spadl až při první otázce.
-- `emit_rent_claim_contradictions` je nad ním (volá ho) — pořadí drží tenhle
-- soubor, protože `\ir` je jediné, co se na BĚŽÍCÍ databázi přehraje; SoT soubor
-- bez řádku tady se nasadí jen na čerstvou DB a produkce běží dál na staré verzi.
\ir sql/functions/get_rent_current.sql
\ir sql/functions/answer_verified_facts.sql
\ir sql/functions/emit_rent_claim_contradictions.sql

-- ── Textové hledání ve ZNĚNÍ dokumentů (2026-07-30) ──────────────────────────
-- Index musí předcházet funkci: mcp_search_knowledge_v2 na něj spoléhá výrazem
-- norm_text(chunk_text). Obojí je idempotentní (IF NOT EXISTS / OR REPLACE),
-- takže heals smí běžet opakovaně. Pořadí norm_text → index → funkce drží
-- pravidlo „helper dřív než jeho volající" (index má norm_text ve výrazu).
\ir sql/indexes/idx_knowledge_chunks_text_trgm.sql
\ir sql/functions/mcp_search_knowledge_v2.sql

-- 2026-09-29: klíče protistrany a naší firmy jako GENEROVANÉ sloupce registru + btree.
-- ⛔ Pod RLS jde do indexu jen leakproof podmínka; výraz nad `fields` jí není, takže
-- karta protistrany procházela celou evidenci (riq: resolve 2 706 ms jako admin,
-- 23 ms jako service_role). Sloupce DŘÍV než PRVNÍ čtečka, která je čte — to je
-- get_scope_options hned níž (owner_company_value), pak counterparty_labels,
-- get_debtor_invoices a resolve/docs v sekci karty; SQL tělo se kontroluje už při
-- CREATE. Stráž v souboru tabulky: jeden přepis, další migrate tabulku nezamyká.
\ir sql/tables/li_source_registry.sql
\ir sql/indexes/idx_li_source_registry_counterparty_id_value.sql
\ir sql/indexes/idx_li_source_registry_counterparty_value.sql

-- Volby přepínače pohledu: seznam našich firem ODVOZENÝ z dat, ne číselník.
-- Bez něj by je musel znát klient — tedy instanční data v kódu shellu.
\ir sql/functions/get_scope_options.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-30 latence extranetu: predikát nároku PATŘÍ do InitPlanu ────────
-- Změřeno na produkci (li_source_registry 43 157 řádků / 133 MB, EXPLAIN ANALYZE
-- pod rolí authenticated — service_role má RLS bypass, pod ním se to NEUVIDÍ):
--   registr jako admin        10 405 ms → 27 ms
--   registr BEZ nároku        41 252 ms → 42 ms   (neoprávněný platil NEJVÍC → DoS páka)
--   li_obligations               123 ms → 3,7 ms
-- Příčina: predikát RLS se vyhodnocuje PER ŘÁDEK a `is_admin_or_staff` byla
-- (jediná ze své třídy) VOLATILE. Samotné STABLE latenci NEŘEŠÍ — změřeno
-- 10 509 ms; Postgres STABLE funkci z RLS `qual` nevytáhne, vytáhne jen poddotaz.
-- Nárok se NEMĚNÍ: doloženo shodou md5 množiny viditelných řádků před/po pro
-- admina (43 157 / d6a19cc9…81f7) i pro identitu bez rolí (0 řádků).
-- Funkce PŘED policies — policy ji volá.
\ir sql/functions/is_admin_or_staff.sql
\ir sql/policies/Admins_and_staff_can_view_audit_journal.sql
\ir sql/policies/knowledge_items_Per_story_KB_visible_to_participants.sql
\ir sql/policies/translations__Admin_can_manage_translations.sql

-- Funkční index pro TEXTOVÝ join generických review bloků na registr
-- (li.id::text = r.source_key). Přepsat join na `source_key::uuid` NELZE —
-- source_key UUID být nemusí (jiný zdroj 0/37: klíče jsou názvy firem a lokalit). Blok pd_review 673 ms → 5,1 ms, pd_recommend 576 → 3,1 ms.
\ir sql/indexes/idx_li_source_registry_id_text.sql

-- ── v1 prostor: 1536 → 1024 (existing-DB reconcile) ──────────────────────────
-- Rozměr sloupce je vlastnost MODELU, který korpus embeduje. 1536 byl tvar po
-- `text-embedding-3-small`, tedy po cloudu; instance embeduje LOKÁLNĚ modelem
-- bge-m3, který dává 1024. Neshoda nebyla teoretická: Postgres odmítne každý
-- zápis, takže vektorová vrstva zůstávala prázdná.
--
-- PROČ SE TO SMÍ: změřeno 2026-07-30 na produkci — `knowledge_embeddings` 0 řádků,
-- `agent_memories` 0 řádků, `expert_rules` 21 řádků a 0 vektorů. Přetypování tedy
-- nemůže o nic přijít; nad daty by to bylo NEPŘÍPUSTNÉ (pgvector mezi rozměry
-- nepřevádí a `USING NULL` by je zahodil).
--
-- PROČ SE TO NEDÁ NECHAT NA SoT: `CREATE TABLE IF NOT EXISTS` na existující DB
-- typ sloupce nezmění — na cold startu vznikne rovnou 1024, na běžící DB by
-- zůstalo 1536 a rozdíl by nikdo neviděl až do prvního zápisu.
--
-- HNSW indexy na těch sloupcích visí, takže padají PŘED přetypováním; SoT soubory
-- je vytvoří znovu (`indexes/` se v pořadí složek přehrávají po `tables/`).
-- Blok je idempotentní: na sloupci, který už 1024 je, neudělá nic.
DO $$
DECLARE
  v_cil CONSTANT text := 'vector(1024)';
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tabulka, a.attname AS sloupec, i.indexrelid::regclass AS idx
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND a.attnum = ANY (i.indkey)
     WHERE (c.relname, a.attname) IN
             (('knowledge_embeddings','embedding'),
              ('agent_memories','embedding'),
              ('expert_rules','content_embedding'))
       AND format_type(a.atttypid, a.atttypmod) <> v_cil
  LOOP
    IF r.idx IS NOT NULL THEN
      EXECUTE format('DROP INDEX IF EXISTS %s', r.idx);
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE %s USING NULL',
      r.tabulka, r.sloupec, v_cil);
    RAISE NOTICE 'v1 prostor: %.% přetypováno na %', r.tabulka, r.sloupec, v_cil;
  END LOOP;
END $$;
\ir sql/indexes/idx_knowledge_embeddings_vector.sql
\ir sql/indexes/idx_agent_memories_embedding.sql
\ir sql/indexes/idx_expert_rules_content_embedding.sql

-- ─── 2026-07-30 mapa toku z ingestu: návrhové sloveso pro drain ─────────────
-- flow_map_artifact měřil ingest autonomně, ale na platformě neměl čtenáře —
-- táž třída díry jako workflow_runs_artifact. Návrh uzlu má VLASTNÍ sloveso
-- (guard _admin funkce se nerozšiřuje): service_role smí navrhnout, neaktivita
-- je vynucená tvarem INSERTu a aktivace zůstává lidský akt v administraci.
\ir sql/functions/propose_production_flow_node.sql
\ir sql/functions/propose_production_workflow_template.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-30 ratifikace mapy toku: fronta + verdikt, který přežije měření ──
-- 435 navržených uzlů leželo v produkci a NIKDO je neviděl — návrh bez fronty
-- není návrh, je to sklad. Fronta čte NErozhodnuté návrhy seřazené podle síly
-- důkazu; verdikt se zapisuje týmž pevným slovesem jako každá jiná recenze
-- (submit_evidence_review_audited, větev flow_node) a PŘEŽIJE další drain —
-- jinak by re-drain vzkřísil zamítnuté a fronta by nikdy nezkonvergovala.
\ir sql/functions/propose_production_flow_node.sql
\ir sql/functions/get_flow_node_queue.sql
\ir sql/functions/submit_evidence_review_audited.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-30 večer: workflow fronta — nárok množinově + InitPlan policies ─
-- Řidičská páska (dv_handover/wf_my_steps přes get_workflow_my_steps_block)
-- trvala 33-48 s: per-row workflow_step_visible_to (SECURITY DEFINER = žádný
-- inline = 60 642 volání) + per-row auth.uid() (JWT parsing v join filtru,
-- ~215 µs/řádek). Funkce sama je v heals výše (\ir na ř. ~8382) — tady se
-- dodávají policies a indexy, které k té změně patří:
--   · policies kroků/dávek/twin_refs/user_roles obalené do (select …) → InitPlan
--     (přímé čtení pod authenticated: EXPLAIN ukázal ~13 s per-row filtr)
--   · nároková ramena dostala indexy → BitmapOr, surový dotaz 1,5 ms
-- Změřeno po opravě: 33 325 ms → 36 ms; dispečerský all_assignees ~48 s → 286 ms.
-- Rovnocennost: 9/9 shoda CELÉHO výstupu (3 identity × 3 varianty, bez
-- freshness_at); nárok policies doložen md5 množin. Vše testováno v begin;…
-- rollback; na produkci před nasazením.
\ir sql/policies/production_workflow_steps.sql
\ir sql/policies/production_batches.sql
\ir sql/policies/Admins_can_manage_batches.sql
\ir sql/policies/twin_external_refs_read.sql
\ir sql/policies/Admins_can_manage_roles.sql
\ir sql/indexes/idx_pws_assigned_role.sql
\ir sql/indexes/idx_pws_assigned_user.sql
\ir sql/indexes/idx_pws_authorized_twin.sql

-- ─── 2026-07-30 scope jako VEKTOR: jediný vlastník pravidla + zápis běhu ────
-- Zadání majitele: „řešit jako vektor a zanést to do systému, protože bychom
-- mohli mít šum a blbě bychom řešili odpovědnosti."
--
-- Šum měl jméno: odpovídač si scope hádal z textu otázky (token labelu proti
-- 1 194 firemním twinům), takže po přidání přepínače pohledu by existovaly DVA
-- zdroje pravdy a vyhrával by ten nezamýšlený. Odpovědnost měla taky jméno:
-- žádný záznam o tom, kdo se pod jakým pohledem co dozvěděl — `intent` a
-- `source` se počítaly a zahazovaly.
--
-- POŘADÍ NENÍ VOLITELNÉ:
--   1. scope_normalize  — kanonický tvar vektoru (bez závislostí),
--   2. scope_effective  — JEDINÝ vlastník pravidla (volá normalize),
--   3. scope_story_id   — vazba běhu na uzel (volá effective),
--   4. DROP starých signatur PŘED jejich novou verzí: přidaný default parametr
--      by jinak nechal obě varianty naživo a KAŽDÉ volání se 2 (resp. 4)
--      argumenty by skončilo „function is not unique",
--   5. answer_verified_facts (scope autoritativní) → get_answer_block (zápis běhu).
\ir sql/functions/scope_normalize.sql
\ir sql/functions/scope_effective.sql
\ir sql/functions/scope_story_id.sql

DROP FUNCTION IF EXISTS public.answer_verified_facts(text, text);
DROP FUNCTION IF EXISTS public.create_ai_run(text, uuid, uuid, jsonb);

\ir sql/functions/create_ai_run.sql
\ir sql/functions/answer_verified_facts.sql
\ir sql/functions/get_answer_block.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-31 twin_* čtecí policies do InitPlanu (Registry sekce ~1 s/blok) ─
-- Z prohlížeče přes API (Server-Timing gw): Registry = 5 bloků á ~1 000 ms,
-- payload 1–3 kB — čistě server. get_twin_register: 813 ms; plný průchod
-- twin_entities pod authenticated 704 ms (2 716 řádků × per-row is_admin_or_staff,
-- ingest tabulku živě plní). Po obalení do (select …): funkce 76–107 ms, plný
-- průchod 57 ms. Nárok doložen v JEDNOM repeatable-read snapshotu: admin 2 725 /
-- md5 2835b717…, bez rolí 0/0. twin_external_refs_read už obalený přišel s #55.
\ir sql/policies/twin_entities_read.sql
\ir sql/policies/twin_events_read.sql
\ir sql/policies/twin_parameter_definitions_read.sql

-- ─── 2026-07-31 registr: identitou dokladu je JMÉNO, sha je verze obsahu ────
-- Refresh téhož dokladu (bohatší stažení — přibude stav úhrady, položky) měnil
-- obsah → jiný `source_sha256` → ON CONFLICT nic nenašel → DRUHÝ řádek. Naměřeno
-- na produkci 07-30: re-ingest 4 050 faktur přidal 4 050 řádků, 3 227 jmen bylo
-- dvakrát. Schéma přitom `doc_identity: "@filename"` deklarovalo od začátku —
-- jen to nikdy nic nevyhodnocovalo. Rekey podle jména je fail-safe (jen
-- jednoznačný případ) a bezpečný: na registr neukazuje žádný FK a `filename`
-- je unikátní u všech 63 830 řádků (obojí změřeno, ne odhadnuto).
\ir sql/functions/li_upsert_source_registry.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-31 registr: index na jméno + set-based rekey (Query read timeout) ─
-- Rekey podle jména se ptal poddotazem NA ŘÁDEK: dávka 4 050 faktur proti 63 830
-- řádkům = 4 050 sekvenčních průchodů → `Query read timeout`, li-driver bundle
-- fail-closed odmítl a držel kurzor (správně — žádný částečný zápis). Oprava je
-- v obojím: chybějící index pod dotazem, který se nově ptá každý běh, a agregace
-- předem místo korelovaného poddotazu.
\ir sql/indexes/idx_li_source_registry_filename.sql
\ir sql/functions/li_upsert_source_registry.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-31 registr dokladů: strop odpovědi (5 MB v jedné odpovědi) ─────
-- `get_document_register` vracel VŠECHNY řádky. Naměřeno na produkci po nasazení
-- sekce „Smlouvy a nájmy": blok `sm_invoices` = 23 739 řádků = 5,06 MB / 727 ms
-- v jedné odpovědi, a s růstem korpusu to roste dál. Strop je default 500
-- (přebitelný v source_params bloku = DATA) s tvrdou pojistkou 5 000.
\ir sql/functions/get_document_register.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-31 bloky sekce Smlouvy a nájmy: dlužníci + rozpad N/E/P ────────
-- Registr je per-doklad; dlužník i rozpad příjmů jsou AGREGÁTY přes doklady
-- jednoho odběratele, a agregace nad li_* smí být výhradně v RPC (klientsky ne).
-- Obě čtečky stojí na stavu úhrady z účetnictví (`amount_unpaid` = Money
-- UhradyZbyva), NE na `settled`/PriznakVyrizeno — ten je u uhrazené faktury
-- False a blok postavený na něm by tvrdil miliardové nedoplatky.
-- Klasifikace nájem/energie/služby je DATA (vzory v source_params bloku).
-- get_twin_register: BEZ tohohle řádku se změna funkce na běžící databázi
-- NIKDY nedostane — baseline je jen pro cold start. Naměřeno 2026-08-01:
-- filtr `has_param` byl v mainu i v baseline, ale produkce ho neměla, takže
-- blok nájemců vracel 1 354 protistran z účetnictví místo 70 nájemců.
\ir sql/functions/get_twin_register.sql
-- ⭐ ZPĚTNÁ VAZBA JEN NA VLASTNÍ ZPRÁVU (2026-09-29, SELF_IMPROVEMENT_LOOP.md K-16). Naměřeno
-- na main 9087ef3df: submit_ai_feedback byla SECURITY INVOKER a chat_messages čte jen správce
-- → uživatel neviděl ani vlastní zprávu, conversation_id zůstal NULL a zpětná vazba se nikdy
-- nestala trénovacím párem; zároveň přijímala cizí message_id/run_id (otrava dat, jakmile by
-- dráha fungovala) a org_id z libovolného partnera. Teď DEFINER se stráží vlastnictví.
\ir sql/functions/submit_ai_feedback.sql
-- 2026-09-26: stav pohledávky má JEDEN slovník (invoice_state; parametry instance
-- receivable_from_param + storno_values_param)
-- pro dlužníky, faktury odběratele i kartu protistrany níž. Helper DŘÍV než jeho
-- volající — SQL tělo se kontroluje už při CREATE (check_function_bodies).
\ir sql/functions/receivable_from_param.sql
\ir sql/functions/storno_values_param.sql
\ir sql/functions/invoice_state.sql
-- 2026-09-29: přehledy protistran klíčuje IČO a jméno berou z counterparty_labels
-- (týž výběr jako karta) — helper DŘÍV než oba volající (dlužníci, rozpad nájmů).
\ir sql/functions/counterparty_labels.sql
\ir sql/functions/get_receivables_overdue.sql
-- Druhé patro prokliku z pohledávek (dlužník → jeho faktury). Bez `\ir` by
-- funkce zůstala jen v SoT a na nasazené DB by neexistovala — proklik by mlčel
-- stejně jako předtím, jen o patro níž.
\ir sql/functions/get_debtor_invoices.sql
-- 2026-09-29: kniha faktur za měsíc — období z parametrů bloku (helper DŘÍV než volající)
\ir sql/functions/obdobi_od_param.sql
\ir sql/functions/get_rent_breakdown.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-31 BEZPEČNOSTNÍ OPRAVA: definer nesmí obcházet nárok ────────────
-- Živý test přes veřejné api pod identitou BEZ ROLÍ (token ražený jako gateway):
--   assemble_surface_traced('workbench') → 631 kB: 500 dokladů + 509 závazků +
--   164 nálezů, přestože tytéž bloky přes get_block_data vracely PRÁZDNO.
-- Kořen: DEFINER funkce volá INVOKER get_block_data → „volajícím" je vlastník
-- (superuser, RLS bypass), ne uživatel. Táž třída u dvou review bloků, jejichž
-- jediný guard byl `auth.uid() is null` = pouhé přihlášení (pd_review vracel
-- bez rolí 14 položek s reálnými protistranami; po opravě 0, admin 14 beze změny).
-- Funkce PŘED granty (revoke odkazuje na jejich signatury).
\ir sql/functions/get_twin_ref_review_block.sql
\ir sql/functions/get_doc_expiry_review_block.sql
\ir sql/grants/revoke_definer_bez_naroku.sql
\ir sql/grants/migration_log_dump_jen_cteni.sql

NOTIFY pgrst, 'reload schema';

-- ─── 2026-07-30 monitorovací role: konfigurace na ni ukazuje, nikdo ji netvoří ─
-- postgres-exporter se do DB hlásí jako `postgres_exporter` (DATA_SOURCE_NAME
-- v docker-compose.coolify-observability.yml) a KAŽDÝCH 10 s dostane
-- „password authentication failed" — protože ta role v databázi NENÍ. Změřeno
-- na živé instanci 2026-07-30: `pg_roles` zná jen `pg_monitor` (což je skupina,
-- ne přihlašovací účet). Metriky Postgresu tím pádem nemá kdo sbírat —
-- monitoring je slepý zrovna na databázi.
--
-- PROČ TO CHYBÍ: infra/pg17/set-passwords.sh se odkazuje na migraci
-- 20260521010000_pg_extensions_audit_and_perf.sql, která tu roli měla založit.
-- Ta migrace v repu NENÍ (ani v archive/) a v baseline se `postgres_exporter`
-- nevyskytuje. Konfigurace tedy ukazuje na účet, který nikdo nezakládá.
--
-- PROČ JE TO HEAL A NE MIGRACE: na databázi, která už schéma má, jde migrate.mjs
-- větví adopt-baseline (markApplied bez provedení) — přesně důvod, proč tenhle
-- soubor existuje. Forward migrace by navíc padla na baseline-only-release bránu.
--
-- HESLO SE TU NENASTAVUJE ZÁMĚRNĚ: heals je SQL bez přístupu k tajemství.
-- Roli založíme, heslo jí dá set-passwords.sh při příštím startu DB — což je
-- přesně sled, který jeho vlastní komentář popisuje („set on next boot after
-- its migration"). Do té doby role existuje a nepřihlásí se; to je stav bez
-- oprávnění navíc, ne díra.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres_exporter') THEN
    -- Bez hesla: přihlásit se nepůjde, dokud ho nenastaví set-passwords.sh.
    CREATE ROLE postgres_exporter LOGIN;
  END IF;
END $$;

-- pg_monitor je přesně ten rozsah, který exporter potřebuje: čtení statistik
-- (pg_stat_*, pg_stat_statements) BEZ přístupu k datům v tabulkách.
GRANT pg_monitor TO postgres_exporter;
GRANT CONNECT ON DATABASE postgres TO postgres_exporter;

-- ─── 2026-07-31 MLX build bge-m3 je registrovaný embedder ────────────────────
-- Korpus embeduje local-ingest na Apple Silicon (mlx-community/bge-m3-mlx-fp16),
-- server obsluhuje týž model jako GGUF pod aliasem `bge-m3-embedding`. Seed to
-- u toho aliasu POZNAMENÁVAL („týž model embeduje korpus v local-ingest … takže
-- vektory z bundlu a dotaz z platformy sdílí prostor"), ale poznámka nic
-- nevynucuje: `insert_knowledge_embedding` páruje na PŘESNÝ model_id a bez
-- vlastního řádku odmítl KAŽDÝ vektor z balíčku hláškou
--   „Embedding model mlx-community/bge-m3-mlx-fp16 is not a registered
--    is_embedding model in ai_model_registry"
-- Naměřeno na produkci: balíček vezl 22 905 vektorů, v DB zůstalo 0.
--
-- Registruje se jako SAMOSTATNÝ řádek, ne přejmenováním na vllm alias: vektor má
-- nést, čím byl doopravdy spočítán. Přejmenovat build kvůli průchodu bránou by
-- byla nepravda v provenienci — a brána by tím přestala něco znamenat.
--
-- Prostor je TÝŽ (v1, 1024) — proto se nic dalšího neladí; rozdíl mezi fp16 a
-- kvantizovaným GGUF je numerický šum uvnitř jednoho prostoru, ne jiný prostor.
INSERT INTO public.ai_model_registry (
  provider, model_id, display_name, model_family,
  is_chat_capable, is_embedding, embedding_dimensions,
  context_window, input_price_per_m, output_price_per_m,
  is_available, provider_metadata
) VALUES (
  'mlx', 'mlx-community/bge-m3-mlx-fp16',
  'BGE-M3 MLX fp16 (RAG v1, 1024, korpusový embedder ingestu, NEspustitelný na serveru)', 'bge-m3',
  false, true, 1024, 8192, 0, 0, false,
  '{"notes": "Korpusový embedder local-ingestu na Apple Silicon. TÝŽ prostor jako bge-m3-embedding (v1, 1024).", "rag_space": "v1"}'::jsonb
)
ON CONFLICT (provider, model_id) DO UPDATE
  SET is_embedding = true,
      embedding_dimensions = 1024,
      -- is_available zůstává FALSE: MLX na x86 Linuxu nespustíme. Zápis vektorů
      -- to nepotřebuje, routování ano — a to se na tenhle build nesmí trefit.
      is_available = false;

-- ── 2026-08-01: monotonicita registru + náprava item_type ────────────────────
-- (1) li_upsert_source_registry ŽIL jen v generované baseline — v heals na něj
--     nevedl žádný \ir, takže změny SoT (včetně rekey z 07-31) se do běžící DB
--     pipeline cestou nedostávaly. Odteď je tady, spolu s novým helperem
--     (pořadí drží pravidlo „helper dřív než jeho volající").
--     Nové chování: DO UPDATE odmítne přepsat vytěžení příchozím, které nemá
--     ani polovinu použitelných polí — 2026-07-30 balík z neverzovaného běhu
--     shodil smlouvám 11 z 20 polí a registr od té doby nesl horší pravdu,
--     než jaká ležela v dropu. Ochráněné řádky hlásí návrat jako kept_better.
\ir sql/functions/li_usable_field_count.sql
\ir sql/functions/li_upsert_source_registry.sql

-- (2) Náprava třídy KB položek: stage_emit posílal p_item_type NATVRDO
--     'engineering_doc', ačkoli skutečnou třídu měl o řádek níž a posílal ji
--     do category. Byznys korpus (dodáky, jízdy, faktury, smlouvy…) tak stojí
--     vedle vlastní dokumentace platformy. Správná třída v category JE — takže
--     existující řádky jde opravit UPDATEm, bez re-ingestu 260 tis. položek.
--     Výčet kategorií je ZÁMĚRNĚ uzavřený a měřený na produkci 2026-08-01:
--     'ai_agents' a spol. jsou platformní dokumentace a zůstávají engineering.
--     Idempotentní: druhý běh nenajde žádný řádek ve WHERE.
UPDATE public.knowledge_items
   SET item_type = 'domain_doc'::knowledge_item_type
 WHERE item_type = 'engineering_doc'::knowledge_item_type
   AND category IN ('machine_operation', 'delivery_note', 'invoice', 'contract',
                    'contract_amendment', 'handover_protocol', 'utility_billing', 'email');

-- ─── 2026-08-02 twinsverse osa B: tabulka twin_relations a její zápisové RPC ───
-- se zakládají VÝŠ, před prvním spotřebitelem (viz blok „PŘESUNUTO 2026-09-28“).
\ir sql/functions/twin_graph_descendants.sql

-- Veřejný provozní stav pro anonymního návštěvníka (tři stavy + čas kontroly).
-- Pohled MUSÍ být dřív než funkce, která z něj čte: tajemství (`api_token`,
-- `base_url`, `config`) v projekci fyzicky nejsou, takže veřejná cesta je nemá
-- na dosah — ne že by je jen nečetla.
\ir sql/views/public_service_health.sql
\ir sql/functions/get_public_service_status.sql

-- ── heal: deny-guardy, které se skládaly na NULL (2026-08-04) ───────────────
-- `current_setting('request.jwt.claims', true)` vrátí NULL, když GUC není
-- nastavené; porovnání s NULL je NULL, ne false. Negativní guard postavený na
-- claims proto NEPROBĚHNE (`IF NULL THEN` svou větev nevykoná) — vypadá přísně
-- a je fail-OPEN. 73 funkcí ten idiom neslo; nově čtou roli přes
-- `public.is_service_role()`, která COALESCEuje na false, takže je guard totální.
--
-- ⚠️ Proč to musí být TADY a ne jen v baseline: baseline se na inicializovanou
-- databázi už nikdy neaplikuje. Bez těchhle \ir by opravu dostaly jen čerstvé
-- instalace a KAŽDÁ BĚŽÍCÍ databáze by si fail-open těla nechala — tedy oprava
-- přesně tam, kde na ní nezáleží. Odhalila to upgrade-path brána v CI, ne
-- review.
--
-- Všechny jsou plpgsql (deferred resolution) → pořadí je jedno; `is_service_role`
-- je načtená výš a je v baseline. CREATE OR REPLACE přes \ir = idempotentní.
\ir sql/functions/abort_slot_switch.sql
\ir sql/functions/acquire_slot_lock.sql
-- Zpevnění (b) 2026-09-29: nová signatura (+ p_kontext jsonb) → stará se na UŽ
-- inicializované DB musí zahodit (CREATE OR REPLACE přidá přetížení, nenahradí).
-- Soubor ji dropuje taky; tady je to tvar, který brána signature-drift vyžaduje.
DROP FUNCTION IF EXISTS public.aisha_decrypt_column_audited(bytea);
\ir sql/functions/aisha_decrypt_column_audited.sql
DROP FUNCTION IF EXISTS public.aisha_encrypt_column_audited(text);
\ir sql/functions/aisha_encrypt_column_audited.sql
\ir sql/functions/aisha_propose_static_defense_rule.sql
\ir sql/functions/aitg_auto_close_findings_audited.sql
\ir sql/functions/aitg_detect_drift_audited.sql
\ir sql/functions/aitg_get_automation_audited.sql
\ir sql/functions/aitg_get_coverage_audited.sql
\ir sql/functions/aitg_get_reflection_history_audited.sql
\ir sql/functions/aitg_get_trust_score_audited.sql
\ir sql/functions/aitg_health_summary_audited.sql
\ir sql/functions/aitg_list_active_payloads_audited.sql
\ir sql/functions/aitg_list_automations_audited.sql
\ir sql/functions/aitg_list_open_findings_audited.sql
\ir sql/functions/aitg_next_in_queue_audited.sql
\ir sql/functions/aitg_observability_health_audited.sql
\ir sql/functions/aitg_propose_payload_audited.sql
\ir sql/functions/aitg_propose_remediation_audited.sql
\ir sql/functions/aitg_record_automation_run_audited.sql
\ir sql/functions/aitg_record_reflection_audited.sql
\ir sql/functions/aitg_record_run_audited.sql
\ir sql/functions/aitg_request_waiver_audited.sql
\ir sql/functions/aitg_trigger_automation_audited.sql
\ir sql/functions/apply_web_artifact_to_page.sql
\ir sql/functions/check_trigger_cooldown.sql
\ir sql/functions/commit_slot_switch.sql
\ir sql/functions/complete_web_artifact_ingest.sql
\ir sql/functions/correlate_sentry_with_deploys.sql
\ir sql/functions/create_web_page_version.sql
\ir sql/functions/ensure_stack_default_story.sql
\ir sql/functions/fail_web_artifact_ingest.sql
\ir sql/functions/fn_get_platform_warmup_state.sql
\ir sql/functions/fn_get_trace_anomalies_24h.sql
\ir sql/functions/get_active_slots.sql
\ir sql/functions/get_active_triggers_for_source.sql
\ir sql/functions/get_active_workflow_for_context.sql
\ir sql/functions/get_audit_aggregates.sql
\ir sql/functions/get_last_dashboard_hash.sql
\ir sql/functions/get_latest_drift_state.sql
\ir sql/functions/get_next_playwright_run.sql
\ir sql/functions/get_pending_tooling_proposals.sql
\ir sql/functions/get_recent_b_g_switches.sql
\ir sql/functions/get_recent_sentry_issues.sql
\ir sql/functions/get_recent_switches.sql
\ir sql/functions/get_rollback_history.sql
\ir sql/functions/ingest_sentry_issue.sql
\ir sql/functions/insert_eval_result.sql
\ir sql/functions/insert_model_benchmark.sql
\ir sql/functions/log_integration_action.sql
\ir sql/functions/mark_drift_pending_approval.sql
\ir sql/functions/mark_models_unavailable.sql
\ir sql/functions/mark_playwright_run_running.sql
\ir sql/functions/mark_web_artifact_processing.sql
\ir sql/functions/propose_tooling_artifact.sql
\ir sql/functions/record_drift_observation.sql
\ir sql/functions/record_playwright_result.sql
\ir sql/functions/request_rollback.sql
\ir sql/functions/resolve_deployed_url.sql
\ir sql/functions/resolve_drift.sql
\ir sql/functions/save_chat_message_audited.sql
\ir sql/functions/save_proactive_run.sql
\ir sql/functions/save_workflow_node_run.sql
\ir sql/functions/set_ai_run_workflow.sql
\ir sql/functions/start_playwright_run.sql
\ir sql/functions/start_web_artifact_ingest.sql
\ir sql/functions/store_dashboard_hash.sql
\ir sql/functions/update_rollback_status.sql
\ir sql/functions/update_runtime_admin_audited.sql
\ir sql/functions/update_scheduled_job_run_status.sql
\ir sql/functions/update_slot_health.sql
\ir sql/functions/update_tooling_proposal_status.sql
-- ⭐ ZAKÁZANÝ NÁSTROJ AGENTA SE NEPOUŽIJE (2026-10-01, SELF_IMPROVEMENT_LOOP.md K-36). Naměřeno na
-- main 8640db9ac: route_task slučoval do tools_allowlist jen agent_catalog.allowed_tools a
-- denied_tools nečetl nikdo za běhu → agent dostal nástroj, který mu katalog zakazuje. Nová verze
-- odečte zákazy agentů trasy a vrací tools_denylist (vynucuje ho executor svc-ai-chat). Funkce
-- v heals nebyla — běžící DB držela verzi z cold startu. Signatura beze změny.
\ir sql/functions/route_task.sql
\ir sql/functions/upsert_discovered_model.sql

-- ─── 2026-08-06 AUDIT DRIFTU: granty se i REVOKUJÍ, nejen grantují ──────────
-- Změřeno simulací produkce (baseline 07-30 + dnešní heals) proti čistému
-- cold startu (dnešní baseline). Drift: 2 policy + 6 grantových řádků; všechno
-- ostatní (funkce, sloupce, indexy, triggery, granty funkcí) NULA.
--
-- MECHANISMUS, kvůli kterému tenhle blok existuje: substrate nastavuje
-- ALTER DEFAULT PRIVILEGES (authenticated=arwd na každé nové relaci vlastníka
-- postgres). Objekt založený healsem se proto RODÍ zapisovatelný pro
-- authenticated, a `REVOKE ALL FROM PUBLIC` v jeho souboru to NEZRUŠÍ —
-- PUBLIC je pseudo-role, přímé granty authenticated žijí dál. Cold start to
-- neutralizuje explicitními granty v baseline; běžící DB nikdy.
--
-- ⛔ public_service_health je AUTO-UPDATABLE view nad integration_services
--    (tabulka s api_token/config) BEZ security_invoker: DML skrz view se
--    vyhodnocuje právy VLASTNÍKA, tedy MIMO RLS podkladu. S default granty
--    mohl přihlášený uživatel INSERT/UPDATE/DELETE — a DELETE skrz view maže
--    celé řádky integrací včetně jejich tokenů. Cíl je projekce PRO ČTENÍ.
-- ⚠️ twin_relations: nadbytečné DML granty byly inertní (RLS má jen SELECT
--    policy), úklid je hygiena vrstvy, ne oprava díry.
--
-- Cílový stav = přesně to, co říká SoT (a co dostane cold start).
REVOKE INSERT, UPDATE, DELETE ON public.public_service_health FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.public_service_health FROM service_role;
GRANT SELECT ON public.public_service_health TO authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.twin_relations FROM authenticated;

-- ─── 2026-08-06 AUDIT DRIFTU: zastaralé duplicitní policy soubory ───────────
-- Táž policy žila ve DVOU SoT souborech: starém (per-row predikát, mimo heals)
-- a novém (InitPlan, v heals). Generátor baseline emituje oba a vyhrával ten
-- STARÝ — příští cold start by tak vrátil per-row predikát, tedy změřenou DoS
-- páku (41 s na dotaz). Produkci držel správný tvar jen proto, že heals běží
-- až PO baseline. Staré soubory jsou smazané; tady se pro jistotu přehraje
-- kanonická verze (idempotentní DROP+CREATE, na běžící DB no-op se stejným
-- výsledkem). Zbylých 31 dvojic s odlišným tělem hlídá nová brána
-- heals-pokryva-sot — smí jen ubývat.
\ir sql/policies/production_workflow_steps.sql
\ir sql/policies/translations__Admin_can_manage_translations.sql

NOTIFY pgrst, 'reload schema';

-- ── twin-pulse BEAT (2026-08-11, port z <fork>) ─────────────────────────────
-- Doména měla nosič pro REGIME, CONFIRMATION i RECOMPUTE, ale ne pro BEAT:
-- user_reminders.user_id konflatuje subjekt s adresátem a story_reminders je
-- jen story-osa bez adresáta. Bez \ir se tyhle SoT soubory dostanou jen do
-- cold-start baseline — na běžící databázi by změna nikdy nedotekla.
\ir sql/tables/story_pulse_beats.sql
\ir sql/rls/story_pulse_beats.sql
\ir sql/grants/story_pulse_beats.sql
\ir sql/triggers/story_pulse_beats_updated_at.sql
\ir sql/functions/create_pulse_beat_audited.sql
\ir sql/functions/close_pulse_beat_audited.sql
-- ⭐ BĚH HODNOCENÍ ZALOŽÍ SLUŽBA (2026-09-29, SELF_IMPROVEMENT_LOOP.md K-25). Naměřeno na main
-- 9087ef3df: create_eval_run_admin pouštěla jen is_admin_or_staff(), grant ale měla jen
-- service_role (auth.uid() NULL) → nikdy neprošla; benchmarkRunner chybu spolkne a eval_run_id
-- byl vždy NULL. Funkce v heals nebyla.
\ir sql/functions/create_eval_run_admin.sql
\ir sql/functions/append_subject_entry_service.sql
\ir sql/functions/get_subject_timeline.sql
\ir sql/functions/grant_story_role_audited.sql
\ir sql/functions/revoke_story_role_audited.sql
\ir sql/functions/audience_admin_complete_followup.sql

-- ── hub/konektor vrstva (2026-08-11, konvergence forku) ────────────────────
-- Forkův heals.sql nesl tyhle položky 23× (1820 řádků / 810 unikátních) —
-- artefakt opakovaných merge, ne záměr. \ir je idempotentní, takže duplikáty
-- nic nerozbily, ale soubor, který se čte při KAŽDÉM heal běhu, se tím
-- zdvojnásobil. Přenáší se proto JEDNOU, v pořadí prvního výskytu
-- (= pořadí, ve kterém byly závislosti poprvé splněné).
\ir sql/tables/hub_source.sql
\ir sql/tables/hub_price_layer.sql
\ir sql/tables/hub_supplier_offer.sql
\ir sql/tables/hub_attribute_source.sql
\ir sql/tables/hub_import_job.sql
\ir sql/tables/hub_reprice_proposal.sql
\ir sql/functions/connector_write_audit.sql
\ir sql/functions/federated_caller_for.sql
\ir sql/functions/federated_identity_link.sql
\ir sql/functions/hub_apply_reprice.sql
\ir sql/functions/hub_assert_source_writable.sql
\ir sql/functions/hub_compose_propagation_plan.sql
\ir sql/functions/hub_compute_price.sql
\ir sql/functions/hub_confirm_reprice.sql
\ir sql/functions/hub_finish_import_job.sql
\ir sql/functions/hub_get_reprice_proposal.sql
\ir sql/functions/hub_price_layers.sql
\ir sql/functions/hub_propose_reprice.sql
\ir sql/functions/hub_recent_import_jobs.sql
\ir sql/functions/hub_reprice_proposals.sql
\ir sql/functions/hub_run_reprice_sweep.sql
\ir sql/functions/hub_start_import_job.sql
\ir sql/functions/hub_sync_reprice_proposal_from_entry.sql
\ir sql/functions/hub_upsert_price_layer.sql
\ir sql/functions/hub_upsert_supplier_offer.sql
\ir sql/functions/hub_verify_provenance.sql
\ir sql/functions/hub_verify_reprice_provenance.sql
\ir sql/functions/hub_write_audit.sql
\ir sql/triggers/hub_price_layer_updated_at.sql
\ir sql/triggers/hub_reprice_proposal_updated_at.sql
\ir sql/triggers/hub_source_updated_at.sql
\ir sql/triggers/hub_supplier_offer_updated_at.sql
\ir sql/triggers/trg_sync_reprice_proposal.sql

-- ── 2026-08-25 — bloky povrchu nad ADMIN pohledy publika ─────────────────────
-- PROČ: Appsmith cockpit publika (appsmith-templates/audience/) čte pět pohledů
-- audience_admin_*_v. Datová vrstva existovala, chyběla obálka, kterou renderer
-- povrchu umí přečíst — neshoda se schématem rendereru blok TIŠE SKRYJE, klient
-- ji nehlásí. Dvě GENERICKÉ funkce (table + chart), konfigurace je v datech
-- (surface_blocks.source_params v instančním overlayi), takže další stránka
-- cockpitu je řádek v datech, ne migrace v kódu.
--
-- BEZPEČNOST: get_block_data slučuje source_params || p_params a KLIENTSKÉ
-- vyhrávají, takže konfigurace bloku není hranice; surface_layouts.audience
-- filtruje jen výpis sekcí. U kontaktních údajů publika drží hranici až
-- is_admin_or_staff() uvnitř funkcí + jmenný prostor ^audience_admin_.*_v$.
\ir sql/functions/get_audience_view_table_block.sql
\ir sql/functions/get_audience_view_chart_block.sql

-- ── 2026-08-30 — index publikovaných stránek pro generátor statického webu ───
-- PROČ: veřejný web je prázdná SPA skořápka — návštěvník stáhne 3,5 MB JS
-- a teprve pak se aplikace ptá na obsah. Naměřeno na produkci: HTML první
-- odpovědi ~2 kB bez obsahu, design až po 1,7 s. Generátor to obrací a vyrábí
-- HTML dopředu, takže první vykreslení JE hotový design.
--
-- Generátor potřeboval dvě věci, které žádná veřejná RPC nedávala: SEZNAM
-- slugů (jinak by je musel mít vepsané natvrdo a nová stránka z editoru by
-- se na web nikdy nedostala) a RAZÍTKO max(updated_at) jako levnou kontrolu
-- čerstvosti — záchytnou síť pro případ, že se ztratí push signál z editoru.
--
-- ── 2026-09-19 — jedno rozlišení značky pro všechny čtečky webu ─────────────
-- Naměřeno na instanci se čtyřmi značkami: tři ze čtyř hostnamů dostaly téma
-- své značky (get_branding_for_hostname rozlišuje podle mapování) a OBSAH
-- globálních stránek, protože tři čtečky stránek pod tímto blokem filtrovaly
-- `bp.status = 'published'` — a publikovaná smí být jen jedna značka bez
-- partnera. Týž dotaz byl vepsaný čtyřikrát a opravený jen jednou.
-- Pomocník jde PŘED své konzumenty; ti se sem znovu nezapojují — `\ir` níž
-- čte aktuální obsah souboru, a druhé zapojení téhož souboru shodilo nasazení
-- 2026-09-06.
\ir sql/functions/resolve_brand_for_hostname.sql
-- Čtvrtý konzument téhož rozlišení. get_branding_for_hostname.sql NEBYL v heals
-- zapojený vůbec — jeho oprava z 2026-06-01 dorazila archivovanou migrací, další
-- změna by se na běžící DB nepřehrála. Zapojen poprvé (žádné druhé \ir).
\ir sql/functions/get_branding_for_hostname.sql

-- BEZPEČNOST: přístupová třída je TÁŽ jako u get_web_page_by_slug — vrací jen
-- slugy stránek, které jsou už teď veřejně čitelné. Žádná nová expozice.
\ir sql/functions/get_published_web_page_index.sql

-- ÚTRŽKY (partials) — hlavička a patička sdílené všemi stránkami.
--
-- Naměřeno 2026-08-30: hlavička byla zkopírovaná v 10 plátnech a na `news`
-- se už rozešla; patička byla totožná ve všech deseti; CSS taktéž (17,9 kB
-- pokaždé). Deset kopií znamená, že se oprava udělá na jedné a na devíti
-- zůstane — což se prokazatelně stalo (mrtvý odkaz `#kb` opravený jen na
-- `news`, a to smazáním).
--
-- Útržek je `web_pages` se `page_settings->>'role' = 'partial'`: týž editor,
-- totéž plátno, tytéž i18n klíče — jen se neservíruje jako samostatná stránka.
--
-- BEZPEČNOST: táž přístupová třída jako get_web_page_by_slug — vrací obsah,
-- který je už teď veřejně čitelný jako součást každé stránky.
\ir sql/functions/get_published_web_partials.sql

-- ⛔ A TÁŽ ZMĚNA MUSÍ DOJET I DO ČTEČKY STRÁNKY (naměřeno 2026-09-03).
--
-- `get_web_page_by_slug` dostal v témže commitu (dbb80d3b9, 2026-08-31)
-- podmínku `page_settings->>'role' <> 'partial'` — útržek se nesmí servírovat
-- jako samostatná stránka. Do heals se ale `\ir` nedoplnil, takže oprava
-- doputovala do SoT i do baseline a na ŽIVOU databázi se nedostala: baseline
-- se na inicializované DB znovu neaplikuje, heals ano.
--
-- Důsledek změřený na produkci jedné instance: `/nav` na její veřejné adrese
-- vykreslilo navigaci jako samostatnou stránku (plátno + `.nav`, text
-- „Language … Stáhnout"). Volání RPC to potvrdilo — `get_web_page_by_slug('nav')`
-- vrátilo řádek, ačkoli zdroj ho už měsíc vylučuje.
--
-- (Adresa se sem nepíše: `heals.sql` je platformní kód a jméno instance do něj
-- nepatří — hlídá to brána legacy-domains.)
--
-- Je to táž past, kterou tenhle soubor popisuje o pár tisíc řádků výš
-- u generických blokových funkcí: „funkce v SoT bez `\ir` v heals se opraví
-- jen cold startem, což na běžící instanci nikdy nenastane."
\ir sql/functions/get_web_page_by_slug.sql

-- ADMINISTRAČNÍ VÝPIS — přibyl sloupec `page_settings`.
--
-- ⛔ DROP + \ir, ne jen \ir. Přidání sloupce do RETURNS TABLE mění návratový
-- typ a `CREATE OR REPLACE` to neumí; bez DROPu by heals padl na „cannot
-- change return type of existing function".
--
-- ⛔ A MUSÍ TO BÝT TADY, ne jen v sql/functions/. Baseline se aplikuje na NOVÉ
-- databáze; už běžící instance konvergují přes heals.sql. Bez tohohle by
-- administrace na existující instanci sloupec nikdy nedostala — nasazení by
-- přitom bylo zelené a útržek by se ve výpisu tiše netvářil jako útržek.
DROP FUNCTION IF EXISTS public.get_web_pages_admin(uuid);
\ir sql/functions/get_web_pages_admin.sql

-- PostgREST si schéma drží v cache — bez tohohle nová RPC neuvidí.
NOTIFY pgrst, 'reload schema';

-- ── ADR-003 „Jeden svět" — K1 identita, K2 kloub krok ↔ takt (2026-09-05) ─────
-- Rozhodnutí operátora: DVOJČE = ENTITA A IDENTITA, STORY = PROJEKCE A KONTEXT
-- (docs/adr/ADR-003-jeden-svet.md, model docs/architecture/ONE_WORLD_MODEL.md).
--
-- K1: audience modul byl klíčovaný na účet (profiles.user_id) — kolega bez
-- účtu, firma ani kontaktní osoba klienta se nedali vyjádřit. Účet je od teď
-- jedna POTVRZENÁ reference (ref_kind='account') na entitě: twin_ensure_for_account
-- (mint-or-match), twin_for_account (lookup), twin_backfill_accounts_admin
-- (dorození před-K1 profilů; volá se po nasazení, opakovaně do 0), provisioning
-- federovaných členů zakládá dvojče + referenci. Registr = pohled nad dvojčaty
-- (audience_admin_twin_directory_v: účty bez dvojčete se NESMÍ ztratit → řádky
-- 'unbound'), vazby a role = audience_admin_twin_relations_v.
--
-- K2: milník běhu takt neotevíral (TWIN_PULSE_MODEL §5) a follow-up byl takt +
-- kompatibilní ai_tasks řádek mimo běh — dvě pravdy o téže práci. Teď: první
-- lidský uzel běhu otevře takt (ensure_workflow_run_for_subject →
-- workflow_step_open_beat), potvrzení kroku takt uzavře se záznamem na ose
-- subjektu a otevře takt dalšího uzlu (complete_workflow_step). Follow-up je
-- jednouzlový BĚH ze šablony `follow-up` (seed jádra 17_workflow_templates_generic),
-- audience_admin_create_followup vrací id TAKTU, audience_admin_complete_followup
-- ho uzavírá dokončením kroku (jediná zápisová cesta práce). Fronta a overlay
-- čtou takty; staré ai_tasks follow-upy se pořád dají uzavřít (zdroj 'ai_task').
--
-- ⛔ Bez \ir tady by nic z toho na běžící instanci nedoteklo (baseline = jen
-- cold start). Pořadí: pomocníci → kloub → běh → follow-up → pohledy.
\ir sql/functions/twin_for_account.sql
\ir sql/functions/twin_ensure_for_account.sql
\ir sql/functions/twin_backfill_accounts_admin.sql
\ir sql/functions/audience_provision_federated_member.sql
\ir sql/functions/workflow_step_open_beat.sql
\ir sql/functions/ensure_workflow_run_for_subject.sql
\ir sql/functions/complete_workflow_step.sql
\ir sql/functions/audience_admin_create_followup.sql
\ir sql/functions/audience_admin_complete_followup.sql

-- Fronta mění tvar sloupců (due_at timestamptz místo text, nové sloupce původu
-- a subjektu): CREATE OR REPLACE VIEW neumí měnit typ sloupce → DROP + \ir.
-- Bez CASCADE záměrně: kdyby na frontě něco záviselo, má to spadnout nahlas.
DROP VIEW IF EXISTS public.audience_admin_followup_queue_v;
\ir sql/views/audience_admin_followup_queue_v.sql
\ir sql/views/audience_actor_overlay_v.sql
-- ⛔ TENHLE POHLED SE PŘETVÁŘÍ, NENAHRAZUJE. `CREATE OR REPLACE VIEW` umí sloupce
-- jen přidávat za poslední, takže jakákoli změna POŘADÍ je pro Postgres
-- přejmenování a nasazení spadne — naměřeno v prod 2026-09-06 10:02Z
-- („cannot change name of view column open_beats to relation_kinds"): migrate
-- exit 1, stack bez gateway, API 502. Pohled nemá v jádru ani v instancích
-- žádného SQL konzumenta (overlay ho jmenuje jen jako DATA v source_params
-- bloku), takže smazat a vytvořit je bezpečné a pořadí sloupců tím přestává být
-- past pro každou další změnu. Hlídá src/tests/db/pohled-jde-nahradit.test.ts.
drop view if exists public.audience_admin_twin_directory_v;
\ir sql/views/audience_admin_twin_directory_v.sql
\ir sql/views/audience_admin_twin_relations_v.sql
-- ⛔ STATISTIKY NAD NOVÝM MODELEM (naměřeno 2026-09-07). Analytická vrstva
-- měřila `profiles`/`openclaw_notifications` — tedy model, jehož funkci mezitím
-- převzala dvojčata. V číslech: starý 15 osob / 0 notifikací / 1 kampaň, nový
-- 370 dvojčat / 1 578 událostí / 1 415 dokladů. Ze 22 pohledů `audience_*`
-- nečetlo 16 vůbec nikdo a většina z nich měřila předchůdce. Nešlo tedy
-- o „málo dat", ale o SPRÁVNÁ data ŠPATNÉHO modelu — což vypadá jako prázdná
-- komunita, a to je horší než zjevná chyba.
\ir sql/views/audience_admin_activity_monthly_v.sql
\ir sql/views/audience_admin_twin_composition_v.sql
\ir sql/views/audience_admin_relation_kinds_v.sql
GRANT SELECT ON public.audience_admin_followup_queue_v, public.audience_admin_twin_directory_v,
                public.audience_admin_twin_relations_v, public.audience_admin_activity_monthly_v,
                public.audience_admin_twin_composition_v, public.audience_admin_relation_kinds_v
                TO authenticated, service_role;

-- Šablona `follow-up` je DATA (seed jádra), ne schéma — na běžící instanci ji
-- dodá seed profil při nasazení; tady se jen pojistí, aby create_followup po
-- healu nepadal na "no active template" na instanci, která seed nespouští.
INSERT INTO public.production_workflow_templates
  (id, name, description, product_type, steps, workflow_steps, is_active, is_default, version,
   name_key, description_key, current_version_number)
SELECT '00000000-0000-4000-8000-00000000f011'::uuid, 'follow-up',
  'Generic single-node follow-up: one human milestone owed by an assignee by a due date. Kernel template for the audience module; instances name their own journeys.',
  'generic',
  '[{"step_code":"follow_up","step_name":"Follow-up","step_order":1,"description":"Reach the subject and record the outcome.","beat_type":"follow_up"}]'::jsonb,
  '[{"step_code":"follow_up","step_name":"Follow-up","step_order":1,"description":"Reach the subject and record the outcome.","beat_type":"follow_up"}]'::jsonb,
  true, false, '1', 'workflow.templates.follow_up.name', 'workflow.templates.follow_up.description', 1
WHERE NOT EXISTS (SELECT 1 FROM public.production_workflow_templates t WHERE t.name = 'follow-up');

NOTIFY pgrst, 'reload schema';

-- ── ADR-003 K3 — kontrakt klientských parametrů + detail dvojčete (2026-09-05) ──
-- W4 (2026-09-03) správně vzal restricted bloku parametry klienta; tím ale
-- zmizela legální cesta pro detail záznamu (`twin_id`), hledání a osu pohledu
-- — jediný způsob byl snížit citlivost bloku, tedy obcházení. Teď je to
-- DEKLARACE v datech (`source_params.client_params`, typ ověřen, kolize s
-- konfigurací zahozena — surface_client_params_filter) a get_block_data ji
-- vymáhá. Tabulkový blok vydává `row_kind` + `rows[].id` (řádek jako záznam
-- pro detail_by_kind) a umí filtr [{src,param}] jako literál; přibývají
-- generické bloky record_detail a timeline nad `audience_admin_*_v` a osa
-- dvojčete jako pohled. Vše měřeno testy client-params-contract a
-- audience-detail-blocks proti čisté DB.
-- ⛔ Bez \ir tady by se změna na běžící instanci neobjevila (baseline = cold start).
\ir sql/functions/surface_client_params_filter.sql
\ir sql/functions/get_block_data.sql
\ir sql/functions/get_audience_view_table_block.sql
\ir sql/functions/audience_record_block_empty.sql
\ir sql/functions/get_audience_view_record_block.sql
\ir sql/functions/get_audience_view_timeline_block.sql
\ir sql/functions/get_audience_view_kpi_block.sql
\ir sql/views/audience_admin_twin_timeline_v.sql
GRANT SELECT ON public.audience_admin_twin_timeline_v TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ── ADR-003 K4 — akce správy z plochy: allowlist akcí + maska action_form (2026-09-06) ──
-- Plocha měla jedinou zápisovou cestu (review_queue → submit_evidence_review_audited)
-- s uzavřeným výčtem entit; správa (značky, přiřazení, dotek, follow-up) šla jen
-- dílnou. Teď: AKCE JSOU DATA (`surface_actions`, řádek v overlayi = jedna
-- akce: cílové RPC, mapa argumentů, deklarace polí, publikum), JEDNA maska
-- `action_form` (get_surface_actions_block vydá akce dostupné volajícímu pod
-- RLS) a JEDNO auditované RPC `submit_surface_action` (INVOKER: slug →
-- RPC přes allowlist, payload ověřen proti deklaraci, argumenty pojmenovaně
-- jako literály s typem, audit). Klient jméno RPC nikdy neposílá.
-- + `audience_admin_log_touch`: operátorský záznam doteku na ose subjektu
--   (volitelně s follow-upem = běh, K2).
-- ⛔ Bez \ir tady nic z toho na běžící instanci nedoteče (baseline = cold start).
\ir sql/tables/surface_actions.sql
\ir sql/policies/surface_actions_select_active.sql
\ir sql/policies/surface_actions_service_all.sql
\ir sql/grants/surface_actions.sql
\ir sql/triggers/surface_actions_updated_at.sql
\ir sql/functions/get_surface_actions_block.sql
\ir sql/functions/submit_surface_action.sql
\ir sql/functions/audience_admin_log_touch.sql

-- ── ADR-003 K5 — osy pohledu jsou data (2026-09-06) ─────────────────────────
-- Seznam os přepínače byl KONSTANTOU v generickém shellu a nesl jména věcí jedné
-- instance (`owner_company`, `unit_site`); v sanghě proto obě osy vracely nula
-- voleb a přepínač se vůbec nekreslil. Teď: řádek `surface_scope_axes` = jedna
-- osa (jméno i substrát dodává overlay), `get_scope_options` umí šest DRUHŮ
-- substrátu (přibyly druh entity, vazba, skupina, rodina šablon) a
-- `get_surface_scope_axes` vydá sekci hotový přepínač včetně voleb.
-- Pořadí: tabulka → politiky/granty/trigger → options (producent) → osy
-- (konzument). Pohled registru dostává `relation_kinds` a tabulkový blok
-- deklarovaný operátor `contains`, jinak by osa nad štítky a vazbami jen zdobila.
\ir sql/tables/surface_scope_axes.sql
\ir sql/policies/surface_scope_axes_select_active.sql
\ir sql/policies/surface_scope_axes_service_all.sql
\ir sql/grants/surface_scope_axes.sql
\ir sql/triggers/surface_scope_axes_updated_at.sql
-- `get_scope_options`, pohled registru i tabulkový blok už heals zapojuje výš;
-- `\ir` čte AKTUÁLNÍ obsah souboru, takže jejich rozšíření dorazí odtamtud.
-- Druhé zapojení téhož souboru je přesně vzor, který 2026-09-06 shodil nasazení.
\ir sql/functions/get_surface_scope_axes.sql

-- ── Profil nese jméno a e-mail (2026-09-06) ─────────────────────────────────
-- ⛔ NAMĚŘENO V PROD: `handle_new_user()` zakládal profil jen s identifikátory,
-- takže 7 účtů ze 7 mělo prázdný e-mail i jméno. Registr publika a popisek
-- dvojčete z nich čtou, takže CELÁ plocha byla bezejmenná. Oprava triggeru platí
-- pro NOVÉ účty; existující profily je potřeba dorovnat, jinak by vada zůstala
-- viditelná přesně tam, kde vznikla.
--
-- Dorovnává se JEN PRÁZDNÉ — ruční úprava profilu je pravda o člověku a seed ji
-- nesmí přepsat. Idempotentní: druhý běh už nemá co doplňovat.
\ir sql/functions/handle_new_user.sql
-- Vazby mezi dvojčaty: stráž pouštěla jen admin/staff, takže service_role
-- (seedy, provisioning) vazbu neotevřel. Sjednoceno se sourozenci modulu.
\ir sql/functions/twin_relation_open_admin.sql
\ir sql/functions/twin_relation_close_admin.sql

UPDATE public.profiles p
   SET email = nullif(btrim(coalesce(u.email, '')), '')
  FROM aisha_auth.users u
 WHERE u.id = p.user_id
   AND nullif(btrim(coalesce(p.email, '')), '') IS NULL
   AND nullif(btrim(coalesce(u.email, '')), '') IS NOT NULL;

UPDATE public.profiles p
   SET display_name = nullif(btrim(coalesce(
         u.raw_user_meta_data->>'display_name',
         u.raw_user_meta_data->>'name',
         u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'preferred_username',
         '')), '')
  FROM aisha_auth.users u
 WHERE u.id = p.user_id
   AND nullif(btrim(coalesce(p.display_name, '')), '') IS NULL
   AND nullif(btrim(coalesce(
         u.raw_user_meta_data->>'display_name',
         u.raw_user_meta_data->>'name',
         u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'preferred_username',
         '')), '') IS NOT NULL;

-- Popisek dvojčete vznikl v době, kdy byl profil prázdný — dorovnat ze stejného
-- zdroje, ale opět JEN tam, kde chybí (přejmenované dvojče je rozhodnutí člověka).
UPDATE public.twin_entities t
   SET label = COALESCE(nullif(btrim(p.display_name), ''), p.email)
  FROM public.twin_external_refs r
  JOIN public.profiles p ON p.user_id = r.source_key::uuid
 WHERE r.twin_id = t.id
   AND r.ref_kind = 'account' AND r.state = 'confirmed' AND r.valid_to IS NULL
   AND r.source_key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   AND nullif(btrim(coalesce(t.label, '')), '') IS NULL
   AND COALESCE(nullif(btrim(p.display_name), ''), p.email) IS NOT NULL;
-- Latentní vada objevená K4 testem: štítek nad účtem padal na NOT NULL
-- partner_id/story_id (back-port resource-štítků nechal sloupce povinné).
-- Sladění tabulky (DROP NOT NULL + CHECK + částečný unikát) a obě zapisující funkce.
\ir sql/tables/story_labels.sql
\ir sql/indexes/story_labels_resource_label_key.sql
\ir sql/functions/audience_tag_resource.sql
\ir sql/functions/audience_admin_bulk_tag.sql

-- Maska `action_form` do výčtu block_type. JEDINÝ zapisovatel výčtu (viz
-- varování u timing_tower/handover_confirm výše); slovník drží types.ts
-- BLOCK_TYPES, schemas.ts si ho importuje, parity test hlídá SQL ↔ schéma.
-- CHECK block_type: JEDINY zapisovatel je blok timing_tower/handover_confirm/action_form
-- vys (2026-07-28 -> 2026-09-06). Sem NIC - viz incident 2026-09-06 (API 502).

-- ── heal #NN: zdroj dat se dá ZAPNOUT a dostat pověření z administrace ──
--
-- ⛔ CO SE NAMĚŘILO (2026-09-01). Jediný UPDATE nad `agent_knowledge_sources`
-- v celém SoT byl `is_active = false` (`deactivate_plugin_runtime`). Zapnutí
-- neexistovalo — žádná funkce, žádná cesta z administrace. `money` proto stál
-- neaktivní a broker každou minutu psal „aktivace je rozhodnutí člověka",
-- zatímco ten člověk neměl čím rozhodnout.
--
-- Druhá polovina: pověření ke zdroji neměla KAM. `agent_knowledge_sources`
-- nemá sloupec na tajemství a `config` je čitelná jsonb, kterou administrace
-- zobrazuje. Pluginy `tcars-fleet`, `webdispecink-fleet` a `eurowag-telematics`
-- přitom deklarují po TŘECH polích s `secret: true`.
--
-- ⭐ Šifrovací aparát (`aisha_encrypt_column_audited`) v repu byl a NIKDO ho
-- nepoužíval. Tohle je jeho první konzument — nic nového se nevymýšlelo.
--
-- Pořadí: tabulka → RLS (bez policy = deny all) → trigger → funkce.
\ir sql/tables/agent_knowledge_source_secrets.sql
\ir sql/rls/agent_knowledge_source_secrets.sql
-- 2026-09-29 zpevnění (b): tabulku pověření přímo nečte žádná role kromě vlastníka
\ir sql/grants/agent_knowledge_source_secrets.sql
\ir sql/triggers/agent_knowledge_source_secrets_updated_at.sql
\ir sql/functions/set_data_source_secrets.sql
\ir sql/functions/get_data_source_secret_status.sql
\ir sql/functions/activate_data_source.sql
\ir sql/functions/deactivate_data_source.sql

-- ⭐ SYSTÉMOVÝ PLUGIN SMÍ PODAT STROJ, AKTIVOVAT HO SMÍ JEN ČLOVĚK (2026-09-04).
-- `submit_plugin` dostal větev pro `is_service_role()`: stroj podá s natvrdo
-- `trust_tier='internal'`, bez autora a ve výchozím `status='submitted'`.
-- Do provozu vede až `transition_plugin_status`, které vyžaduje admina.
-- ⛔ Bez tohohle `\ir` by změna zůstala jen v SoT a na běžící instance by se
-- NEDOSTALA — funkce bez zavedení je zdokumentovaná vada tohohle repozitáře.
\ir sql/functions/submit_plugin.sql

NOTIFY pgrst, 'reload schema';

-- ── heal #39: konfigurace zdroje se dá ZMĚNIT z administrace ──
--
-- ⛔ NAMĚŘENO 2026-09-01. Systém uměl zdroj založit s konfigurací a (od téhož
-- dne, heal #38) zapnout i vypnout — ale ZMĚNIT konfiguraci ne. Faktury se z ERP
-- netahaly, protože zdroj měl v `doc_markers` jediný marker, zatímco mapy pro obě
-- faktury ležely v bundlu hotové. Změna na dva řádky se musela udělat přímým
-- UPDATEm a zápis do žurnálu dopsat ručně. Vznik měl cestu, změna ne.
--
-- Funkce SLUČUJE (`config || p_patch`), nepřepisuje: administrace mění jeden klíč,
-- ne celý objekt. Neznámý klíč je výjimka (překlep by jinak tiše nic neudělal),
-- pokud volající výslovně nepovolí `p_allow_new_keys`. Klíč, který vypadá jako
-- tajemství, se odmítne s ukazatelem na `set_data_source_secrets` — tajemství
-- nepatří do `config`, protože ten se čte i na místech bez šifrování.
\ir sql/functions/set_data_source_config.sql

-- ── heal #40: publikovat plugin jde i ÚZKÝM oprávněním, ne jen rolí ──
--
-- ⛔ NAMĚŘENO 2026-09-02. Zdroje `money` a `webdispecink-fleet` byly zapnuté
-- přes dvě hodiny a nepřibyl ani JEDEN řádek: `plugin_catalog` i
-- `plugin_schedules` měly nulu, takže nebylo co naplánovat ani co spustit.
-- Katalog zůstal prázdný proto, že `submit_plugin` autorizuje přes
-- `is_admin_or_staff()` — a stroj publikační dráhy by tedy musel dostat roli
-- `admin`/`staff` se vším, co k ní patří.
--
-- ⭐ Role odpovídá na „kdo to je“, oprávnění na „co smí“. Přibývá proto TŘETÍ
-- případ: držitel `publish_plugins` smí publikovat, ale s tierem PEVNĚ
-- `internal` — nevolí ho z manifestu jako admin. Ta cesta je tím UŽŠÍ než
-- adminova, ne mocnější. Původní dvě větve zůstávají beze změny.
\ir sql/functions/submit_plugin.sql

NOTIFY pgrst, 'reload schema';

-- ── heal #41: vedení kamenolomu — čtecí RPC nad Money evidencí ──
--
-- Surface `vedeni` (48_surface_sections v instance-data, zatím inactive) dostává
-- osm čtecích RPC. Všechny jedou SECURITY INVOKER nad `document_registry` (tabulka
-- vzniká výš, heal ~#? / baseline) — pohledávky/závazky, aging, největší expozice
-- po splatnosti, top odběratelé, cena/t, výhled inkasa, fakturační skluz a
-- manažerské alerty. Metadata kontrakt (jak Money doklad „přistává" do
-- document_registry.metadata) je ukotvený v hlavičce get_vedeni_finance_kpi.sql:
-- dokud ho ingest neplní, tabulka je prázdná a RPC vracejí NEMĚŘENO (null / prázdné
-- koše) s proveniencí — nikdy vymyšlenou 0. `paidDate IS NULL` je JEDINÝ spolehlivý
-- indikátor neuhrazení (Money `Stav` je vždy 0). CREATE OR REPLACE → idempotentní.
\ir sql/functions/get_vedeni_finance_kpi.sql
\ir sql/functions/get_vedeni_aging.sql
\ir sql/functions/get_vedeni_overdue.sql
\ir sql/functions/get_vedeni_top_customers.sql
\ir sql/functions/get_vedeni_cena_t_trend.sql
\ir sql/functions/get_vedeni_vyhled_inkasa.sql
\ir sql/functions/get_vedeni_alerts.sql

-- ⚠️ PŘEČÍSLOVÁNO PŘI MERGE 2026-09-05: tyhle tři bloky vznikly jako #41–#43,
-- jenže main mezitím dostal SVŮJ #41 (vedení kamenolomu). Číslo je pořadí
-- v chronologii, ne jméno — dvě větve na něj sáhly nezávisle. Posunuto na
-- #42–#44 za mainovu #41; obsah beze změny, jen odkazy uvnitř komentářů
-- posunuty s ním.
-- ── heal #42: surface „vozový park“ — agregační data RPC nad twin substrátem ──
--
-- ⭐ CO PŘIBYLO. Sekce `vozovy_park` (instance overlay, zatím inactive) dostává
-- vlastní bloky. Register/karta/identita vozidel jedou reusem hotových RPC
-- (get_twin_register / get_twin_detail / get_twin_identity_queue /
-- get_twin_events_table_block). Nové jsou jen tři agregace, které generický
-- reader neumí (headline KPI, spotřeba per vůz, palivová bilance):
--   • get_fleet_kpi          — kpi_tile, metrika přes p_params->>'metric'
--   • get_fleet_consumption  — chart(bar): l/100 km vs Ø délka trasy per vůz
--   • get_fleet_fuel_balance — table: natankováno − spotřeba = Δ nádrž + sonda
-- Všechny SECURITY INVOKER (RLS na twin_* fail-closed), provenance u každého čísla.
-- SoT bez \ir se na běžící DB nikdy nepřehraje — proto sem, ne jen do baseline.
\ir sql/functions/get_fleet_kpi.sql
\ir sql/functions/get_fleet_consumption.sql
\ir sql/functions/get_fleet_fuel_balance.sql
-- Odstavená vozidla (parked). get_fleet_findings je až v heal #44 — závisí na
-- wd_overspeed, a SQL funkce se validuje při vzniku (tabulka musí být dřív).
\ir sql/functions/get_fleet_parked.sql

NOTIFY pgrst, 'reload schema';

-- ── heal #43: WD tacho worktime — „Výkony řidičů podle tachografu" ──
--
-- ⭐ CO PŘIBYLO. `_getDriverWorkTacho` vrací denní tacho výkony řidiče
-- (TotalDrive/Work/Rest v sekundách, per den × vozidlo). Nová vendor tabulka
-- `wd_worktime` (stejný vzor jako wd_rides): tabulka → RLS (bez policy = deny)
-- → trigger updated_at → upsert. Read RPC `get_fleet_worktime` z ní staví blok
-- „Dodržování jízdních dob" v pohledu vozový park. SoT bez \ir se na běžící DB
-- nikdy nepřehraje — proto sem, ne jen do baseline. Pořadí: tabulka → policy →
-- trigger → funkce.
\ir sql/tables/wd_worktime.sql
\ir sql/indexes/wd_worktime_driver_date_idx.sql
\ir sql/policies/wd_worktime_read.sql
\ir sql/policies/wd_worktime_service.sql
\ir sql/triggers/wd_worktime_updated_at.sql
\ir sql/functions/wd_upsert_worktime_audited.sql
-- get_fleet_worktime je až v heal #44 — nově joinuje wd_driver_stats.

NOTIFY pgrst, 'reload schema';

-- ── heal #44: WD překročení rychlosti (wd_overspeed) + statistika řidičů
--    (wd_driver_stats) — dvě další fleet-wide vrstvy, které dají KAŽDÝ vůz. ──
--
-- ⭐ `_getCarOverSpeed` → wd_overspeed (úseky s max. rychlostí, časem, POLOHOU,
-- řidičem) napájí finding „Překročení rychlosti" v get_fleet_findings — narozdíl
-- od dopočtu z telematiky nese kde/kdy/kdo. `_getStaDrivers` → wd_driver_stats
-- (služební/soukromé km, doba den/noc, snapshot per řidič) obohacuje blok
-- jízdních dob (get_fleet_worktime). Pořadí: tabulky → policy → trigger → upsert,
-- a AŽ POTOM oba read RPC (SQL funkce se validuje při vzniku, tabulka musí být dřív).
\ir sql/tables/wd_overspeed.sql
\ir sql/indexes/wd_overspeed_car_time_idx.sql
\ir sql/policies/wd_overspeed_read.sql
\ir sql/policies/wd_overspeed_service.sql
\ir sql/triggers/wd_overspeed_updated_at.sql
\ir sql/functions/wd_upsert_overspeed_audited.sql
\ir sql/tables/wd_driver_stats.sql
-- FK fleet vrstev → wd_drivers/wd_vehicles. Až TADY: všechny tři dětské tabulky
-- (wd_worktime #42, wd_overspeed + wd_driver_stats #43) už existují a rodiče
-- jsou z dřívějška. Brána fk-relationship-gaps (cold-start) to vymáhá.
\ir sql/constraints/wd_fleet_relationships_fkey.sql
\ir sql/policies/wd_driver_stats_read.sql
\ir sql/policies/wd_driver_stats_service.sql
\ir sql/triggers/wd_driver_stats_updated_at.sql
\ir sql/functions/wd_upsert_driver_stats_audited.sql
-- Read RPC až teď — jejich těla referencují nové tabulky.
\ir sql/functions/get_fleet_findings.sql
\ir sql/functions/get_fleet_worktime.sql

-- ── PRŮKAZY ZAŘÍZENÍ PRO VRÁTNÉHO (2026-09-09) ───────────────────────────────
-- Změřeno: VER 2 ověřování i mobilní strana byly hotové, ale zavedené zařízení
-- neměl kdo schválit — roster vrátného je proměnná v Coolify a otisk se do něj
-- dostával jedině ručním opisem 130 hex znaků z obrazovky telefonu. Takový krok
-- se v praxi neudělá, takže automatické ťukání nemohlo nikdy začít fungovat.
--
-- Kořen důvěry zůstává ruční zaklepání ČLOVĚKEM: teprve otevřenými dveřmi se dá
-- přihlásit, a přihlášená appka svůj otisk ohlásí sama (`register_knock_device`).
-- Správce pak schvaluje něco, co už mu leží na stole, u konkrétního uživatele.
--
-- ⛔ Pořadí: tabulka → policy → RPC. Funkce se odkazují na tabulku i na
-- `mobile_sessions` (most `push_device_id`), takže musí být až za nimi.
\ir sql/tables/knock_device_credentials.sql
\ir sql/triggers/knock_device_credentials_updated_at.sql
\ir sql/policies/knock_device_credentials_policies.sql
\ir sql/functions/register_knock_device.sql
\ir sql/functions/admin_list_knock_devices.sql
\ir sql/functions/admin_set_knock_device_approval.sql

-- ── ÚČET PATŘÍ NEJVÝŠ JEDNOMU TWINU (2026-09-10) ─────────────────────────────
-- Naměřeno: `uq_twin_external_refs_active_owner` hlídá (source, source_key,
-- ref_kind), ale `get_my_workflow_steps` čte vazbu účtu BEZ `source`. Dvě
-- potvrzené vazby na týž účet s různým zdrojem by tedy prošly obě a řidič by
-- viděl dodávky dvou lidí — tiše, protože „vidím víc" nevypadá jako vada.
-- Nejdřív TABULKA: nese CHECK, který u vazby účtu připouští jediný `source`.
-- Bez něj by indexy jen zakrývaly rozpor mezi modelem (source rozlišuje)
-- a čtenářem (source nečte).
\ir sql/tables/twin_external_refs.sql
\ir sql/indexes/uq_twin_external_refs_active_account.sql
-- Druhá polovina páru: jeden TWIN = nejvýš jeden aktivní účet. Bez ní by se
-- neomezenou pozvánkou navázalo na jednu osobu libovolně mnoho účtů.
\ir sql/indexes/uq_twin_external_refs_active_account_twin.sql
-- ⛔ `twin_bind_account` ZRUŠENA (majitel, 2026-09-10): „proč nechápeš tuhle
-- část user managementu jen jako další vstup pro ingest? Ten přece následně
-- zanese tu vazbu a uživatel měl potvrdit entitu."
--
-- Měl pravdu a byl to druhý navrhovatel vedle ingestu: `twin-producer.ts` už
-- dnes vazby nabízí přes `twin_identity_propose_binding` a jeho vlastní
-- hlavička říká „Confirmation stays human — that is the whole point of the
-- review lane this feeds". Ta lane běží (`get_twin_ref_review_block`,
-- `state='proposed'`). Vazba účtu není jiný druh vazby než ostatní.
--
-- Zůstává jen ČTENÍ: „kdo má twin a nemá účet" — otázka, na kterou review lane
-- neodpovídá (ta ukazuje NÁVRHY, ne nepřítomnost) a bez které se nedá
-- rozhodnout, komu poslat pozvánku.
\ir sql/functions/twin_accounts_missing.sql

-- ── POZVÁNKA UMÍ SPÁŘIT S TWINEM (2026-09-10) ────────────────────────────────
-- Druhá polovina úkonu správce (zadání majitele): u člověka, který účet ještě
-- NEMÁ, se nepřiděluje — posílá se pozvánka. Vazba pak vznikne z uplatnění,
-- tedy z úkonu, který ten člověk sám udělal, a nemusí se hádat podle telefonu
-- (`wd_drivers` e-mail nemá, takže automaticky spárovat nejde).
--
-- ⛔ `create_invitation` MUSÍ BÝT TADY, ne jen v baseline. Přibyl jí parametr,
-- takže soubor nese `DROP` staré signatury — a bez `\ir` by se na existující
-- databázi neprovedl NIKDY. Zůstala by tam obě přetížení a PostgREST by u
-- volání bez `p_twin_id` hlásil nejednoznačnost. Baseline běží jen při cold
-- startu; tohle je přesně ten případ, kdy „hotová" oprava nikdy nedoteče.
\ir sql/tables/invitations.sql
-- ⛔ DROP JE TU I PŘESTO, ŽE HO NESE SÁM SOUBOR (a `\ir` ho tedy provede).
-- Brána `heals-signature-drift` ho tady vyžaduje záměrně: destruktivní krok
-- má být vidět TAM, KDE SE ROZHODUJE POŘADÍ NASAZENÍ, ne jen uvnitř souboru.
-- Kdyby ho někdo v souboru později ubral jako „jednorázový", heals by přestal
-- starou signaturu odstraňovat — a poznalo by se to až podle PGRST202 na
-- instancích, které mají obě přetížení.
DROP FUNCTION IF EXISTS public.create_invitation(text, uuid, text, text, integer, timestamp with time zone, text, text, text, text);
\ir sql/functions/create_invitation.sql
\ir sql/functions/claim_invitation.sql

NOTIFY pgrst, 'reload schema';

-- ── PREDIKÁT NÁROKU DO INITPLANU — A DO BĚŽÍCÍ DB (2026-09-12) ───────────────
--
-- Změřeno: 417 souborů politik volalo pomocníka nároku PER ŘÁDEK. Postgres
-- STABLE funkci z RLS `qual` sám nevytáhne — vytáhne jen poddotaz. Na jedné
-- tabulce to dům naměřil 2026-07-30 jako 10 405 ms × 27 ms nad 43 157 řádky,
-- a neoprávněný platil nejvíc (41 252 ms za NULA řádků) — tedy DoS páka.
-- Sesterská oprava tehdy pokryla čtyři největší tabulky; tohle je zbytek.
--
-- ⛔ PROČ TO MUSÍ BÝT TADY: baseline běží jen při COLD STARTU. Oprava jen ve
-- zdroji by byla v repu vidět a v provozu by NEEXISTOVALA — přesně třetí vada,
-- kterou pojmenovává hlavička brány rls-predikat-a-indexy. Soubory proto
-- dostaly `DROP POLICY IF EXISTS` (heals se přehrává při každém migrate) a jsou
-- zapojené sem.
--
-- Bezpečnost okna mezi DROP a CREATE: všech 421 politik je PERMISSIVE (žádná
-- RESTRICTIVE — ověřeno), takže okamžik bez politiky může nanejvýš ODEPŘÍT
-- řádky, nikdy je odhalit. U restriktivní politiky by byl směr opačný.

\ir sql/policies/Admin_can_delete_all_sessions.sql
\ir sql/policies/Admin_can_manage_achievements.sql
\ir sql/policies/Admin_can_manage_all_AI_sessions.sql
\ir sql/policies/Admin_can_manage_all_shipments.sql
\ir sql/policies/Admin_can_manage_all_story_entries.sql
\ir sql/policies/Admin_can_manage_all_story_labels.sql
\ir sql/policies/Admin_can_manage_all_story_reminders.sql
\ir sql/policies/Admin_can_manage_all_studies.sql
\ir sql/policies/Admin_can_manage_block_types.sql
\ir sql/policies/Admin_can_manage_consent_items.sql
\ir sql/policies/Admin_can_manage_consent_requirements.sql
\ir sql/policies/Admin_can_manage_consultants.sql
\ir sql/policies/Admin_can_manage_contributions.sql
\ir sql/policies/Admin_can_manage_distribution_protocols.sql
\ir sql/policies/Admin_can_manage_languages.sql
\ir sql/policies/Admin_can_manage_leaderboard_reward_config.sql
\ir sql/policies/Admin_can_manage_question_blocks.sql
\ir sql/policies/Admin_can_manage_questionnaire_blocks.sql
\ir sql/policies/Admin_can_manage_questionnaire_versions.sql
\ir sql/policies/Admin_can_manage_questionnaires.sql
\ir sql/policies/Admin_can_manage_ratings.sql
\ir sql/policies/Admin_can_manage_registrations.sql
\ir sql/policies/Admin_can_manage_reminders.sql
\ir sql/policies/Admin_can_manage_resolutions.sql
\ir sql/policies/Admin_can_manage_role_definitions.sql
\ir sql/policies/Admin_can_manage_roles.sql
\ir sql/policies/Admin_can_manage_schema_repairs.sql
\ir sql/policies/Admin_can_manage_shipment_settings.sql
\ir sql/policies/Admin_can_view_all_completions.sql
\ir sql/policies/Admin_can_view_all_consent_acceptances.sql
\ir sql/policies/Admin_can_view_all_profiles.sql
\ir sql/policies/Admin_can_view_all_responses.sql
\ir sql/policies/Admin_can_view_all_sessions.sql
\ir sql/policies/Admin_can_view_resolutions.sql
\ir sql/policies/Admin_can_view_schema_repairs.sql
\ir sql/policies/Admin_can_view_shipment_settings.sql
\ir sql/policies/Admin_full_access_to_health_logs.sql
\ir sql/policies/Admin_full_access_to_health_states.sql
\ir sql/policies/Admin_full_access_to_product_logs.sql
\ir sql/policies/Admin_full_access_to_product_plans.sql
\ir sql/policies/Admin_full_access_to_products.sql
\ir sql/policies/Admin_full_access_to_widgets.sql
\ir sql/policies/Admin_staff_can_delete_decision_trees.sql
\ir sql/policies/Admin_staff_can_delete_golden_examples.sql
\ir sql/policies/Admin_staff_can_insert_decision_trees.sql
\ir sql/policies/Admin_staff_can_insert_golden_examples.sql
\ir sql/policies/Admin_staff_can_insert_template_versions.sql
\ir sql/policies/Admin_staff_can_manage_eval_results.sql
\ir sql/policies/Admin_staff_can_manage_eval_runs.sql
\ir sql/policies/Admin_staff_can_manage_improvement_proposals.sql
\ir sql/policies/Admin_staff_can_manage_model_benchmarks.sql
\ir sql/policies/Admin_staff_can_manage_model_registry.sql
\ir sql/policies/Admin_staff_can_manage_news.sql
\ir sql/policies/Admin_staff_can_manage_sensor_alerts.sql
\ir sql/policies/Admin_staff_can_manage_topic_translations.sql
\ir sql/policies/Admin_staff_can_manage_training_datasets.sql
\ir sql/policies/Admin_staff_can_manage_training_examples.sql
\ir sql/policies/Admin_staff_can_read_all_feedback.sql
\ir sql/policies/Admin_staff_can_read_decision_trees.sql
\ir sql/policies/Admin_staff_can_read_golden_examples.sql
\ir sql/policies/Admin_staff_can_read_template_versions.sql
\ir sql/policies/Admin_staff_can_update_decision_trees.sql
\ir sql/policies/Admin_staff_can_update_golden_examples.sql
\ir sql/policies/Admin_staff_full_access_to_production_flow_nodes.sql
\ir sql/policies/Admin_staff_full_access_to_production_flow_records.sql
\ir sql/policies/Admin_staff_full_access_to_production_flow_substances.sql
\ir sql/policies/Admins_and_staff_can_manage_ui_preferences.sql
\ir sql/policies/Admins_and_staff_can_view_all_node_factory_requests.sql
\ir sql/policies/Admins_and_staff_can_view_audit_logs.sql
\ir sql/policies/Admins_and_staff_can_view_disputes.sql
\ir sql/policies/Admins_can_manage_BOM_entries.sql
\ir sql/policies/Admins_can_manage_CAPA.sql
\ir sql/policies/Admins_can_manage_QC_test_definitions.sql
\ir sql/policies/Admins_can_manage_achievements.sql
\ir sql/policies/Admins_can_manage_all_appointments.sql
\ir sql/policies/Admins_can_manage_all_availability.sql
\ir sql/policies/Admins_can_manage_all_certifications.sql
\ir sql/policies/Admins_can_manage_all_compensations.sql
\ir sql/policies/Admins_can_manage_all_credentials.sql
\ir sql/policies/Admins_can_manage_all_dosing_logs.sql
\ir sql/policies/Admins_can_manage_all_escalations.sql
\ir sql/policies/Admins_can_manage_all_matching_profiles.sql
\ir sql/policies/Admins_can_manage_all_notes.sql
\ir sql/policies/Admins_can_manage_all_orders.sql
\ir sql/policies/Admins_can_manage_all_partner_profiles.sql
\ir sql/policies/Admins_can_manage_all_permissions.sql
\ir sql/policies/Admins_can_manage_all_reviews.sql
\ir sql/policies/Admins_can_manage_all_stories.sql
\ir sql/policies/Admins_can_manage_all_templates.sql
\ir sql/policies/Admins_can_manage_allocations.sql
\ir sql/policies/Admins_can_manage_app_versions.sql
\ir sql/policies/Admins_can_manage_archive_tags.sql
\ir sql/policies/Admins_can_manage_attempts.sql
\ir sql/policies/Admins_can_manage_batch_materials.sql
\ir sql/policies/Admins_can_manage_blinding_config.sql
\ir sql/policies/Admins_can_manage_burns.sql
\ir sql/policies/Admins_can_manage_campaign_runs.sql
\ir sql/policies/Admins_can_manage_campaign_schedules.sql
\ir sql/policies/Admins_can_manage_coefficients.sql
\ir sql/policies/Admins_can_manage_consent_template_versions.sql
\ir sql/policies/Admins_can_manage_consent_templates.sql
\ir sql/policies/Admins_can_manage_cost_lines.sql
\ir sql/policies/Admins_can_manage_cost_rates.sql
\ir sql/policies/Admins_can_manage_cost_scenarios.sql
\ir sql/policies/Admins_can_manage_courses.sql
\ir sql/policies/Admins_can_manage_currency_rates.sql
\ir sql/policies/Admins_can_manage_custom_node_registry.sql
\ir sql/policies/Admins_can_manage_deviations.sql
\ir sql/policies/Admins_can_manage_distribution_adjustments.sql
\ir sql/policies/Admins_can_manage_distribution_calendar.sql
\ir sql/policies/Admins_can_manage_distribution_protocols.sql
\ir sql/policies/Admins_can_manage_distribution_schedule.sql
\ir sql/policies/Admins_can_manage_documents.sql
\ir sql/policies/Admins_can_manage_dose_units.sql
\ir sql/policies/Admins_can_manage_equipment.sql
\ir sql/policies/Admins_can_manage_equipment_calibrations.sql
\ir sql/policies/Admins_can_manage_equipment_cleaning.sql
\ir sql/policies/Admins_can_manage_expedition_calendar.sql
\ir sql/policies/Admins_can_manage_featured_products.sql
\ir sql/policies/Admins_can_manage_forecast_items.sql
\ir sql/policies/Admins_can_manage_forecasts.sql
\ir sql/policies/Admins_can_manage_hero_slides.sql
\ir sql/policies/Admins_can_manage_inventory_events.sql
\ir sql/policies/Admins_can_manage_invitations.sql
\ir sql/policies/Admins_can_manage_knowledge_moderation_queue.sql
\ir sql/policies/Admins_can_manage_knowledge_post_translations.sql
\ir sql/policies/Admins_can_manage_knowledge_posts.sql
\ir sql/policies/Admins_can_manage_knowledge_topic_links.sql
\ir sql/policies/Admins_can_manage_knowledge_topic_versions.sql
\ir sql/policies/Admins_can_manage_knowledge_topics.sql
\ir sql/policies/Admins_can_manage_label_archive.sql
\ir sql/policies/Admins_can_manage_label_templates.sql
\ir sql/policies/Admins_can_manage_leaderboard_entries.sql
\ir sql/policies/Admins_can_manage_leaderboard_periods.sql
\ir sql/policies/Admins_can_manage_locations.sql
\ir sql/policies/Admins_can_manage_locks.sql
\ir sql/policies/Admins_can_manage_logs.sql
\ir sql/policies/Admins_can_manage_lots.sql
\ir sql/policies/Admins_can_manage_materials.sql
\ir sql/policies/Admins_can_manage_metrics.sql
\ir sql/policies/Admins_can_manage_milestones.sql
\ir sql/policies/Admins_can_manage_node_factory_requests.sql
\ir sql/policies/Admins_can_manage_notification_campaigns.sql
\ir sql/policies/Admins_can_manage_packages.sql
\ir sql/policies/Admins_can_manage_parameters.sql
\ir sql/policies/Admins_can_manage_partner_reviews.sql
\ir sql/policies/Admins_can_manage_permissions.sql
\ir sql/policies/Admins_can_manage_preferences.sql
\ir sql/policies/Admins_can_manage_product_access.sql
\ir sql/policies/Admins_can_manage_product_catalog.sql
\ir sql/policies/Admins_can_manage_product_dose_units.sql
\ir sql/policies/Admins_can_manage_product_reviews.sql
\ir sql/policies/Admins_can_manage_production_tokens.sql
\ir sql/policies/Admins_can_manage_products.sql
\ir sql/policies/Admins_can_manage_progress.sql
\ir sql/policies/Admins_can_manage_protocol_steps.sql
\ir sql/policies/Admins_can_manage_protocols.sql
\ir sql/policies/Admins_can_manage_qualification_results.sql
\ir sql/policies/Admins_can_manage_quality_params.sql
\ir sql/policies/Admins_can_manage_questionnaires.sql
\ir sql/policies/Admins_can_manage_reference_ranges.sql
\ir sql/policies/Admins_can_manage_release_decisions.sql
\ir sql/policies/Admins_can_manage_resources.sql
\ir sql/policies/Admins_can_manage_reward_rules.sql
\ir sql/policies/Admins_can_manage_role_permissions.sql
\ir sql/policies/Admins_can_manage_schedule_orders.sql
\ir sql/policies/Admins_can_manage_schema_version.sql
\ir sql/policies/Admins_can_manage_secrets.sql
\ir sql/policies/Admins_can_manage_sensor_readings.sql
\ir sql/policies/Admins_can_manage_slides.sql
\ir sql/policies/Admins_can_manage_study_test_templates.sql
\ir sql/policies/Admins_can_manage_suppliers.sql
\ir sql/policies/Admins_can_manage_symptom_catalog.sql
\ir sql/policies/Admins_can_manage_test_questions.sql
\ir sql/policies/Admins_can_manage_test_templates.sql
\ir sql/policies/Admins_can_manage_token_config.sql
\ir sql/policies/Admins_can_manage_token_events.sql
\ir sql/policies/Admins_can_manage_token_production_events.sql
\ir sql/policies/Admins_can_manage_transactions.sql
\ir sql/policies/Admins_can_manage_variants.sql
\ir sql/policies/Admins_can_manage_vial_assignments.sql
\ir sql/policies/Admins_can_manage_vials.sql
\ir sql/policies/Admins_can_manage_workflow_templates.sql
\ir sql/policies/Admins_can_update_all_lab_test_orders.sql
\ir sql/policies/Admins_can_update_deletion_requests.sql
\ir sql/policies/Admins_can_view_all_assessment_dimensions.sql
\ir sql/policies/Admins_can_view_all_assessment_tags.sql
\ir sql/policies/Admins_can_view_all_assessments.sql
\ir sql/policies/Admins_can_view_all_claims.sql
\ir sql/policies/Admins_can_view_all_consents.sql
\ir sql/policies/Admins_can_view_all_conversations.sql
\ir sql/policies/Admins_can_view_all_data_sharing_consents.sql
\ir sql/policies/Admins_can_view_all_deletion_requests.sql
\ir sql/policies/Admins_can_view_all_documents.sql
\ir sql/policies/Admins_can_view_all_health_data.sql
\ir sql/policies/Admins_can_view_all_health_metrics.sql
\ir sql/policies/Admins_can_view_all_lab_results.sql
\ir sql/policies/Admins_can_view_all_lab_test_orders.sql
\ir sql/policies/Admins_can_view_all_longevity_scores.sql
\ir sql/policies/Admins_can_view_all_memberships.sql
\ir sql/policies/Admins_can_view_all_messages.sql
\ir sql/policies/Admins_can_view_all_notifications.sql
\ir sql/policies/Admins_can_view_all_order_items.sql
\ir sql/policies/Admins_can_view_all_payment_sessions.sql
\ir sql/policies/Admins_can_view_all_plans.sql
\ir sql/policies/Admins_can_view_all_preferences.sql
\ir sql/policies/Admins_can_view_all_rate_limits.sql
\ir sql/policies/Admins_can_view_all_responses.sql
\ir sql/policies/Admins_can_view_all_scores.sql
\ir sql/policies/Admins_can_view_all_sessions.sql
\ir sql/policies/Admins_can_view_all_subscriptions.sql
\ir sql/policies/Admins_can_view_all_summaries.sql
\ir sql/policies/Admins_can_view_all_sync_logs.sql
\ir sql/policies/Admins_can_view_all_vouchers.sql
\ir sql/policies/Admins_can_view_all_wallets.sql
\ir sql/policies/Admins_can_view_all_wearable_analysis_files.sql
\ir sql/policies/Admins_can_view_all_wearable_connections.sql
\ir sql/policies/Admins_can_view_all_wearables_data.sql
\ir sql/policies/Admins_can_view_all_web_push_subscriptions.sql
\ir sql/policies/Admins_can_view_app_versions.sql
\ir sql/policies/Admins_can_view_blockchain_audit_records.sql
\ir sql/policies/Admins_can_view_campaign_runs.sql
\ir sql/policies/Admins_can_view_campaign_schedules.sql
\ir sql/policies/Admins_can_view_notification_campaigns.sql
\ir sql/policies/Admins_can_view_notification_logs.sql
\ir sql/policies/Staff_can_insert_transitions_via_RPC.sql
\ir sql/policies/Staff_can_manage_environments.sql
\ir sql/policies/admin_delete_agent_tools.sql
\ir sql/policies/admin_delete_integration_services.sql
\ir sql/policies/admin_insert_agent_tools.sql
\ir sql/policies/admin_insert_integration_service_logs.sql
\ir sql/policies/admin_insert_integration_services.sql
\ir sql/policies/admin_staff_full_access.sql
\ir sql/policies/admin_staff_manage_agent_catalog.sql
\ir sql/policies/admin_staff_manage_context_profiles.sql
\ir sql/policies/admin_staff_manage_mcp_tokens.sql
\ir sql/policies/admin_staff_manage_moderation_decisions.sql
\ir sql/policies/admin_staff_manage_moderation_sessions.sql
\ir sql/policies/admin_staff_manage_story_contexts.sql
\ir sql/policies/admin_staff_manage_story_participants.sql
\ir sql/policies/admin_staff_manage_story_rulesets.sql
\ir sql/policies/admin_staff_read_ai_runs.sql
\ir sql/policies/admin_staff_read_ai_trace.sql
\ir sql/policies/admin_staff_select_agent_tools.sql
\ir sql/policies/admin_staff_select_integration_service_logs.sql
\ir sql/policies/admin_staff_select_integration_services.sql
\ir sql/policies/admin_update_agent_tools.sql
\ir sql/policies/admin_update_integration_services.sql
\ir sql/policies/aisha_tooling_proposals_read.sql
\ir sql/policies/app_secrets.sql
\ir sql/policies/approval_requests_admin_manage.sql
\ir sql/policies/audit_journal.sql
\ir sql/policies/audit_logs.sql
\ir sql/policies/blockchain_audit_records.sql
\ir sql/policies/chain_head_anchors.sql
\ir sql/policies/collaboration_policies.sql
\ir sql/policies/coolify_app_slots_read.sql
\ir sql/policies/dashboard_render_history_read.sql
\ir sql/policies/data_sensitivity_registry_admin.sql
\ir sql/policies/data_sensitivity_registry_read.sql
\ir sql/policies/design_profiles_admin_all.sql
\ir sql/policies/distribution_calendar.sql
\ir sql/policies/distribution_forecast_items.sql
\ir sql/policies/distribution_forecasts.sql
\ir sql/policies/distribution_schedule.sql
\ir sql/policies/distribution_schedule_orders.sql
\ir sql/policies/drift_state_read.sql
\ir sql/policies/expedition_calendar.sql
\ir sql/policies/governance_ballot_ledger.sql
\ir sql/policies/health_check_ins__Admins_can_view_all_check-ins.sql
\ir sql/policies/health_data_sync_log__Admins_can_view_all_sync_logs.sql
\ir sql/policies/hub_attribute_source_read.sql
\ir sql/policies/hub_import_job_read.sql
\ir sql/policies/hub_price_layer_read.sql
\ir sql/policies/hub_reprice_proposal_read.sql
\ir sql/policies/hub_source_read.sql
\ir sql/policies/hub_supplier_offer_read.sql
\ir sql/policies/instance_auth_tokens_admin_staff_manage_instance_auth_tokens.sql
\ir sql/policies/knowledge_moderation_queue.sql
\ir sql/policies/leaderboard_reward_config__Admin_can_manage_leaderboard_reward_config.sql
\ir sql/policies/ledger_participation_self_manage.sql
\ir sql/policies/member_dashboard_widgets__Admin_full_access_to_widgets.sql
\ir sql/policies/member_health_logs__Admin_full_access_to_health_logs.sql
\ir sql/policies/member_health_states__Admin_full_access_to_health_states.sql
\ir sql/policies/member_product_logs__Admin_full_access_to_product_logs.sql
\ir sql/policies/member_product_plans__Admin_full_access_to_product_plans.sql
\ir sql/policies/member_products__Admin_full_access_to_products.sql
\ir sql/policies/notification_logs.sql
\ir sql/policies/order_approval_rules_admin_all.sql
\ir sql/policies/order_approval_rules_staff_read.sql
\ir sql/policies/product_access_rules_admin_all.sql
\ir sql/policies/product_access_rules_staff_read.sql
\ir sql/policies/product_label_templates.sql
\ir sql/policies/product_vials.sql
\ir sql/policies/production_logs.sql
\ir sql/policies/production_metrics.sql
\ir sql/policies/production_milestones.sql
\ir sql/policies/production_protocol_steps.sql
\ir sql/policies/production_sensor_alerts.sql
\ir sql/policies/production_workflow_templates.sql
\ir sql/policies/profiles__Admin_can_view_all_profiles.sql
\ir sql/policies/project_presets.sql
\ir sql/policies/project_vulnerabilities_read.sql
\ir sql/policies/project_vulnerabilities_write.sql
\ir sql/policies/question_block_types__Admin_can_manage_block_types.sql
\ir sql/policies/question_blocks__Admin_can_manage_question_blocks.sql
\ir sql/policies/questionnaire_blocks__Admin_can_manage_questionnaire_blocks.sql
\ir sql/policies/questionnaire_responses__Admin_can_view_all_responses.sql
\ir sql/policies/questionnaire_versions__Admin_can_manage_questionnaire_versions.sql
\ir sql/policies/reminder_completions__Admin_can_view_all_completions.sql
\ir sql/policies/role_definitions__Admin_can_manage_role_definitions.sql
\ir sql/policies/roles__Admin_can_manage_roles.sql
\ir sql/policies/rollback_history_read.sql
\ir sql/policies/schema_repairs__Admin_can_manage_schema_repairs.sql
\ir sql/policies/schema_repairs__Admin_can_view_schema_repairs.sql
\ir sql/policies/schema_version.sql
\ir sql/policies/security_event_resolutions__Admin_can_manage_resolutions.sql
\ir sql/policies/security_event_resolutions__Admin_can_view_resolutions.sql
\ir sql/policies/sentry_issue_snapshot_read.sql
\ir sql/policies/sentry_monitor_config_admin_read.sql
\ir sql/policies/sentry_monitor_config_admin_write.sql
\ir sql/policies/sentry_project_issues_read.sql
\ir sql/policies/shipment_dispatch_records_self_and_admin.sql
\ir sql/policies/shipment_records__Admin_can_manage_all_shipments.sql
\ir sql/policies/shipment_settings__Admin_can_manage_shipment_settings.sql
\ir sql/policies/shipment_settings__Admin_can_view_shipment_settings.sql
\ir sql/policies/staff_admin_read_events.sql
\ir sql/policies/staff_admin_read_installations.sql
\ir sql/policies/staff_admin_read_repos.sql
\ir sql/policies/story_ai_sessions__Admin_can_manage_all_AI_sessions.sql
\ir sql/policies/story_entries__Admin_can_manage_all_story_entries.sql
\ir sql/policies/story_labels__Admin_can_manage_all_story_labels.sql
\ir sql/policies/story_pulse_beats__admin_staff_manage.sql
\ir sql/policies/story_reminders__Admin_can_manage_all_story_reminders.sql
\ir sql/policies/studies__Admin_can_manage_all_studies.sql
\ir sql/policies/study_blinding_config.sql
\ir sql/policies/study_consent_acceptances__Admin_can_view_all_consent_acceptances.sql
\ir sql/policies/study_consent_items__Admin_can_manage_consent_items.sql
\ir sql/policies/study_consent_requirements__Admin_can_manage_consent_requirements.sql
\ir sql/policies/study_consultants__Admin_can_manage_consultants.sql
\ir sql/policies/study_contributions__Admin_can_manage_contributions.sql
\ir sql/policies/study_distribution_protocols__Admin_can_manage_distribution_protocols.sql
\ir sql/policies/study_questionnaires__Admin_can_manage_questionnaires.sql
\ir sql/policies/study_ratings__Admin_can_manage_ratings.sql
\ir sql/policies/study_registrations__Admin_can_manage_registrations.sql
\ir sql/policies/study_test_templates.sql
\ir sql/policies/supported_languages__Admin_can_manage_languages.sql
\ir sql/policies/system_config_admin_all.sql
\ir sql/policies/system_config_staff_read.sql
\ir sql/policies/tc_drivers_read.sql
\ir sql/policies/tc_groups_read.sql
\ir sql/policies/tc_import_log_read.sql
\ir sql/policies/tc_rides_read.sql
\ir sql/policies/tc_vehicles_read.sql
\ir sql/policies/token_production_events.sql
\ir sql/policies/user_achievements__Admin_can_manage_achievements.sql
\ir sql/policies/user_distribution_schedule_orders.sql
\ir sql/policies/user_reminders__Admin_can_manage_reminders.sql
\ir sql/policies/user_sessions__Admin_can_delete_all_sessions.sql
\ir sql/policies/user_sessions__Admin_can_view_all_sessions.sql
\ir sql/policies/wd_drivers_read.sql
\ir sql/policies/wd_import_log_read.sql
\ir sql/policies/wd_rides_read.sql
\ir sql/policies/wd_vehicle_positions_current_read.sql
\ir sql/policies/wd_vehicle_positions_history_read.sql
\ir sql/policies/wd_vehicles_read.sql
\ir sql/policies/web_page_templates_Admin_and_staff_can_manage_page_templates.sql
\ir sql/policies/web_page_templates_Admin_and_staff_can_read_page_templates.sql
\ir sql/policies/web_page_versions_Admin_and_staff_can_insert_page_versions.sql
\ir sql/policies/web_page_versions_Admin_and_staff_can_read_page_versions.sql
\ir sql/policies/web_pages_policies.sql
\ir sql/policies/workflow_templates.sql

-- Táž oprava pro druhý adresář politik (`sql/rls/`) — univerzum má DVA domovy
-- a průřez přes jeden z nich by nechal 61 predikátů dál běžet per řádek.

\ir sql/rls/agent_live_sessions.sql
\ir sql/rls/ai_spend_policies.sql
\ir sql/rls/client_ratings.sql
\ir sql/rls/consultation_bookings.sql
\ir sql/rls/knowledge_attribution.sql
\ir sql/rls/lab_test_orders_rls.sql
\ir sql/rls/maintenance_contracts.sql
\ir sql/rls/payout_ledger.sql
\ir sql/rls/project_presets.sql
\ir sql/rls/project_revenue.sql
\ir sql/rls/revenue_splits.sql
\ir sql/rls/specialist_activity_metrics.sql
\ir sql/rls/specialist_ratings.sql
\ir sql/rls/story_participants.sql

-- A třetí domov politik: `sql/storage/` (politiky nad storage.objects).

\ir sql/storage/archive-scans.sql
\ir sql/storage/e2e-reports.sql
\ir sql/storage/email-assets.sql
\ir sql/storage/email-templates.sql
\ir sql/storage/health-documents.sql
\ir sql/storage/hero-images.sql
\ir sql/storage/page-assets.sql
\ir sql/storage/product-images.sql
\ir sql/storage/wearable-analysis.sql
\ir sql/storage/web-artifact-sources.sql
-- ── 2026-09-12 — DQ rollup převzatý z forku ──────────────────────────────────
-- PROČ JEDEN, NE DVACET: fork nesl doménovou vrstvu jedné vertikály (tabulky,
-- indexy, policies, triggery, pohled a pět RPC nad entitami té domény). Ta
-- popisuje DOMÉNU, ne platformu — do upstreamu nepatří a s ní odešly i její
-- `\ir` řádky (17). Odešly i obaly pojmenované po dodavateli konektoru
-- (naměřeno 2026-09-12: jen delegovaly na upstreamové `federated_caller_for` /
-- `federated_identity_link` se jménem dodavatele natvrdo, a žádný upstreamový
-- kód je nevolal — jen generované typy). Konektor dodavatele je plugin a jméno
-- dodavatele patří k němu, ne do platformního schématu.
-- Zůstává jen to, co stojí na upstreamových generikách a žádnou doménovou
-- tabulku nepotřebuje (ověřeno: čte jen aitg_runs × aitg_test_catalog):
--   · vehicle_dq_status — rollup nad aitg_runs × aitg_test_catalog (layer='dat',
--     vyhrazený blok test_id AITG-DAT-50..69); volá ho svc-mcp-knowledge
--     (routes/mcp.ts, lib/aitg-tools.ts). Jméno i blok testů nese doménu
--     v platformním schématu — kandidát na přesun k pluginu; přejmenování =
--     migrace + dva konzumenti + generované typy, proto se tu nedělá.
-- Bez `\ir` by žil jen v baseline, která se na běžící DB znovu nepřehrává.
\ir sql/functions/vehicle_dq_status.sql

-- ── Měsíční statistiky zdroje (témata / události) — 2026-09-08 ──────────────
-- Majitel dostával „témata a události za období" jako CSV z API na vyžádání.
-- Teď je adaptér zdroje počítá ŽIVĚ za libovolný měsíc (listStats), broker je
-- v taktu přelije sem (audience_upsert_source_stat) a plocha je čte pohledy —
-- tabulky ve tvaru exportu + agregát pro graf. Jedna tabulka pro oba druhy
-- (kind), pohledy ji rozdělují; booleany zůstávají booleany v datech a text až
-- v pohledu (maska tabulky boolean nepřipouští — incident 2026-09-07).
-- ⛔ Bez \ir tady by se to na běžící instanci neobjevilo (baseline = cold start).
\ir sql/tables/source_period_stats.sql
\ir sql/policies/source_period_stats_admin_all.sql
\ir sql/grants/source_period_stats.sql
\ir sql/functions/audience_upsert_source_stat.sql
\ir sql/views/audience_admin_source_topic_stats_v.sql
\ir sql/views/audience_admin_source_event_stats_v.sql
\ir sql/views/audience_admin_source_stats_monthly_v.sql
\ir sql/views/audience_admin_source_topic_monthly_v.sql
\ir sql/views/audience_admin_source_event_monthly_v.sql
GRANT SELECT ON public.audience_admin_source_topic_stats_v,
                public.audience_admin_source_event_stats_v,
                public.audience_admin_source_stats_monthly_v,
                public.audience_admin_source_topic_monthly_v,
                public.audience_admin_source_event_monthly_v
                TO authenticated, service_role;

-- ── validate_mcp_token vrací i allowed_tools / denied_tools (2026-09-14) ─────
-- Naměřeno: svc-mcp-knowledge nepřijímal `mcp_` PAT vůbec, a n8n agenti tak
-- neměli žádnou dlouhodobou odvolatelnou identitu (KC token vyprší za 300 s).
-- Nová PAT lane v auth.ts potřebuje seznamy nástrojů, aby tools/list i
-- tools/call vymáhala JEDNÍM predikátem. Změna je jen přidání klíčů do jsonb.
\ir sql/functions/validate_mcp_token.sql

-- ── Ratifikace identit z plochy: obálka bloku + zápisová větev (2026-09-15) ───
-- Naměřeno (kontrakt, statická analýza + runtime test): get_twin_ref_review_block
-- vracel jen {items}, maska review_queue chce {entity_kind, items, actions} →
-- klient blok zahodil (907 návrhů identit z ingestu nebylo vidět). A dispečer
-- submit_evidence_review_audited kind 'twin_identity' neznal (22023), takže ani
-- sesterská fronta get_twin_identity_queue neuměla rozhodnout. Obojí se tu
-- přehrává znovu — dřívější \ir výš nesou starší verze.
\ir sql/functions/get_twin_ref_review_block.sql
\ir sql/functions/submit_evidence_review_audited.sql

NOTIFY pgrst, 'reload schema';

-- ── 2026-09-13 — Lokální model pod naší střechou: dostupnost a rozměr se MĚŘÍ ──
-- ⛔ NAMĚŘENO: (1) `mark_models_unavailable` nevolal nikdo, takže seedované vLLM
-- řádky (Qwen/Qwen3-30B-A3B, Qwen/Qwen3-Embedding-4B) zůstávaly is_available=true,
-- ačkoli je nic neobsluhovalo, a resolver je nabízel. (2) `upsert_discovered_model`
-- nenesl rozměr embeddingu — v registru stála jen deklarace k aliasu, který volí
-- instance; resolver prostoru (1024 → v1, 2560 → v2) se o rozměr opírá a nesedící
-- vektor Postgres odmítl až při zápisu.
-- svc-ai-chat discovery teď volá mark_models_unavailable nad ÚPLNÝM živým listingem
-- a měří rozměr (p_embedding_dimensions). DROP 16-arg signatury stojí i tady (brána
-- heals-signature-drift): bez něj by na běžící DB zůstala obě přetížení a PostgREST
-- by volání bez nového parametru hlásil jako nejednoznačné.
DROP FUNCTION IF EXISTS public.upsert_discovered_model(text, text, text, text, boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, numeric, numeric, jsonb, numeric);
\ir sql/functions/upsert_discovered_model.sql
\ir sql/functions/mark_models_unavailable.sql

-- ── KATALOG PLUGINŮ BEZ KONFIGURACE (2026-09-15, bezpečnost) ─────────────────
-- Naměřeno nad origin/main: `get_available_plugins` (SECURITY DEFINER, GRANT
-- anon) projektoval `plugin_tenant_overrides.config_override` jako `config`.
-- V konfiguraci pluginu žijí přihlašovací údaje konektorů; anon klíč +
-- p_tenant_id je vydal, protože DEFINER obchází RLS overrides a tělo se na
-- nárok neptalo. Žádný volající config z katalogu nepotřebuje (SPA ho zod
-- schématem zahazuje, /registry ho nemapuje, resolvePlugin volá bez tenanta,
-- takže dostával vždy `{}`). Katalog ho proto nevydá nikomu — ani service_role,
-- kterou nese i broker sandboxu s parametry zvolenými pluginem.
-- p_tenant_id nově jen pro tenanta samotného, admin/staff a službu (stejný
-- nárok jako RLS tabulky). Signatura beze změny, takže CREATE OR REPLACE
-- zachová existující granty anon/authenticated; přibývá explicitní service_role.
-- ⛔ Bez `\ir` by oprava žila jen v baseline a běžící instance by tajemství
-- vydávaly dál.
\ir sql/functions/get_available_plugins.sql

-- ⭐ PLÁNOVAČ PLUGINŮ (2026-09-16). `plugin_schedules` nikdo neplnil ani nečetl,
-- takže cron capability pluginů nikdy neběžely; `register_plugin_schedule` byl
-- SECURITY DEFINER pro každého přihlášeného bez kontroly nároku. Host teď
-- rozvrhy zapisuje (reconcile), plánovač je atomicky zabírá (claim, SKIP LOCKED)
-- a po běhu zapíše příští termín. Registrace ručně jen služba nebo admin/staff.
-- `submit_plugin` zachová schválení při shodném podání (plugin-publish-init).
\ir sql/functions/register_plugin_schedule.sql
\ir sql/functions/reconcile_plugin_schedules.sql
\ir sql/functions/claim_due_plugin_schedules.sql
\ir sql/functions/set_plugin_schedule_next_run.sql
-- Konfigurace běhu pluginu: host ji dřív posílal jako `{}` v ENV kontejneru
-- a pověření zdroje nikdo nečetl. Broker ji teď vydá pluginu na token běhu.
\ir sql/functions/get_plugin_runtime_config.sql
-- ⭐ ZAPÁLENÍ, POVOLENÍ, MĚŘENÍ (2026-09-24, schváleno majitelem). Naměřeno
-- v produkci instance: plugin_schedules = 0 — rozvrhy vznikaly až po úspěšném
-- běhu, ale první běh nespouštělo nic, takže žádný plugin nikdy neběžel (zdroje
-- „aktivní", pověření vyplněná, tabulky prázdné, týdny bez hlášení). A
-- `granted_capabilities` zdroje nevynucoval NIKDO — po zapálení by plugin stahoval
-- i to, co majitel výslovně nepovolil (polohy). Teď:
--   · plugin_capability_allowed — JEDINÉ místo „smí?"; ptá se reconcile, claim i host;
--   · plugin_declarations + list/record — host zapálí schválený plugin aktivního
--     zdroje (běh jen-deklaruj, init bez stahování), znovu po nové verzi a po selhání;
--   · register_plugin_event jen služba (byl povolený anon) — čte z něj hlídač;
--   · get_data_source_feed_health_block — stav a výkon zdrojů pro správu.
\ir sql/functions/plugin_capability_allowed.sql
\ir sql/tables/plugin_declarations.sql
\ir sql/policies/plugin_declarations_admin_read.sql
\ir sql/grants/plugin_declarations.sql
\ir sql/functions/list_plugins_to_declare.sql
\ir sql/functions/record_plugin_declaration.sql
\ir sql/functions/register_plugin_event.sql
\ir sql/functions/get_data_source_feed_health_block.sql
-- ── 2026-09-15: rozhodnutí nad procesem — uzavřít zastaralé běhy, dohledat, VRÁTIT ──
-- NAMĚŘENO v produkci instance: 126 běhů expedice z 2020–2024 viselo s čekajícím
-- předáním bez řidiče (+ nakládka, přeprava = 378 uzlů). Účetnictví je neuzavřelo,
-- reconcile je proto správně nezavře; majitel rozhodl je uzavřít. Zadání majitele
-- zároveň: „všechny tyto autonomní kroky potřebujeme umět dohledat, dohledovat
-- a případně zrušit a opravit uživatelem z UI". Rozhodnutí = řádek audit_journal
-- (entity_type workflow_decision) se seznamem uzlů a taktů; uzel nese decision_id
-- a stav před uzavřením. Změřeno v begin…rollback: uzavření 126/378, žádná odměna,
-- vrácení obnoví otisk 91 095 kroků i taktů přesně, dvojí vrácení odmítne.
\ir sql/functions/close_stale_workflow_runs_admin.sql
\ir sql/functions/revert_workflow_decision_admin.sql
\ir sql/functions/broker_quarantine_discard_admin.sql
\ir sql/functions/revert_broker_quarantine_discard_admin.sql
\ir sql/functions/get_decisions_admin.sql
\ir sql/functions/get_workflow_decisions_admin.sql

-- ── Katalogy zdroje: celé množiny záznamů pro plochu (2026-09-15) ────────────
-- Naměřeno: plocha čte jen jádro, ale KPI komunity, nadcházející akce, místa
-- a členové existovali jen jako živé /source/* routy brokeru (Appsmith) —
-- blok na ně nedosáhl. Adaptér teď vydá katalog (listCatalog), broker ho
-- v taktu přelije sem, pohledy instance ho promítnou. Jen struktura + zapisovač;
-- jména věcí zdroje zná instance, ne platforma.
\ir sql/tables/source_catalog_rows.sql
\ir sql/indexes/source_catalog_rows_kind_occurred_idx.sql
\ir sql/policies/source_catalog_rows_admin_all.sql
\ir sql/grants/source_catalog_rows.sql
\ir sql/functions/audience_sync_source_catalog.sql

-- ── Práce se záznamy bez účtu: follow-up, štítky, přiřazení nad dvojčetem (2026-09-15) ──
-- Naměřeno v demu extranetu: 4 z 5 akcí správy braly target.user_id / user_ids,
-- takže nad dvojčetem bez účtu (907 záznamů převzatých z Raynetu) padaly 22023.
-- Subjektem práce je dvojče (ADR-003 K1/K2); účet je jen jedna jeho reference.
\ir sql/functions/audience_admin_create_twin_followup.sql
\ir sql/functions/audience_admin_untag_twin.sql
\ir sql/functions/audience_admin_assign_twin.sql
\ir sql/views/audience_admin_twin_directory_v.sql
-- ── 2026-09-18: is_story_partner — predikát o třetí osobě ─────────────────────
-- Sesterská oprava has_role/has_permission (2026-09-12): funkce s GRANT pro anon
-- vydávala komukoli, kdo je partnerem kterého příběhu. Stráž v těle; SoT soubor
-- dosud v heals nebyl, takže by se oprava do běžící DB nedostala.
\ir sql/functions/is_story_partner.sql

-- ── 2026-09-19: sourozenci téže opravy — bez \ir by nedotekli (review 0c, Z-1) ──
-- has_role, has_permission, get_test_questions_localized a get_active_channel_config
-- nesou v tomhle PR stráž nároku, ale stály v dluhu `heals-pokryva-sot` (SoT bez
-- \ir): baseline je dodává jen při cold startu, běžící DB by zůstala s orákulem.
-- ⛔ Před zapojením ZMĚŘENO: produkční těla všech čtyř = SoT na riq/main
--    c2c097274 (md5 prosrc) → \ir nevrací žádnou novější ruční verzi.
-- ⛔ Výkon: stráž v těle has_role stála per řádek 125 ms → 2 985 ms (50k řádků,
--    2026-09-12). Tady se neprojeví: všech 459 přepsaných politik je v heals
--    a VŠECHNA volání predikátů v politikách jsou `(SELECT …((SELECT auth.uid())))`
--    — konstanta za dotaz (InitPlan), žádné volání per řádek (změřeno nad
--    stromem větve: has_role 112×, is_admin_or_staff 437×, is_story_partner 2×).
\ir sql/functions/has_role.sql
\ir sql/functions/has_permission.sql
\ir sql/functions/get_test_questions_localized.sql
\ir sql/functions/get_active_channel_config.sql

-- ── 2026-09-19: jeden ingest = jedna identita zdroje (twiny) ──
-- NAMĚŘENO v produkci instance: přehrání tří balíčků se jménem aplikace
-- `aisha-local-ingest` (30. 8.) založilo 839 twinů `company` (21 % všech) vedle
-- twinů `local-ingest` TÉHOŽ ingestu; 2 189 klíčů pod oběma zdroji, pokaždé na
-- jiný twin. Registr zdrojů to 09-02 sjednotil pohlcením (superseded_by), twiny
-- ne — zapisovatelé párují přesně podle (source, source_key). Prevence: oba
-- zapisovatelé překládají zdroj přes pohlcení (canonical_ingest_source); byli
-- SoT bez \ir (dluh heals-pokryva-sot) — produkční těla změřena shodná se SoT
-- před změnou, zapojení tedy nese jen tuto opravu. Úklid: rozhodnutí nad twiny
-- (náhled výchozí, audit_journal twin_decision, vrácení).
\ir sql/functions/canonical_ingest_source.sql
\ir sql/functions/twin_upsert_entity_audited.sql
-- Vlastnictví kódu parametru (2026-09-29): kód je globální klíč katalogu; definici
-- cizího zdroje nesmí přepsat jiný zdroj (42501). Bez heals by stráž platila jen
-- na studeném startu.
\ir sql/functions/twin_upsert_parameter_definitions_audited.sql
\ir sql/functions/twin_identity_propose_binding.sql
\ir sql/functions/resolve_absorbed_ingest_source_admin.sql
\ir sql/functions/revert_twin_decision_admin.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ POLOHA TABLETU U PŘEDÁNÍ (2026-09-18, rozhodnutí majitele). Řidič posílá
-- polohu zařízení jako `device_position`; uloží se jako `device_geo` VEDLE
-- odvozené `geo` a nikdy ji nenahradí. Je to metainformace k záznamu: shoda
-- dvou nezávislých zdrojů (`agreement_m`) zvyšuje důvěryhodnost v čase a místě.
-- Tvar a výpočet shody drží čistá funkce bez přístupu k tabulkám (testovatelná
-- bez přípravných dat); dispatcher ji jen volá a rozšiřuje uzavřenou množinu klíčů.
-- submit_evidence_review_audited.sql se tu ZNOVU neuvádí: heals běží celý při
-- každém migrate a jeho dřívější \ir už aplikují novou verzi (žádné druhé \ir
-- téhož souboru). plpgsql váže volání až za běhu, pořadí proto nevadí.
\ir sql/functions/evidence_device_geo.sql

-- ── Doporučení identit z ingestu: co porovnat a jak navrhnout (2026-09-20) ──
-- Kontakty převzaté z CRM a účty aplikace jsou dvě dvojčata, dokud je někdo
-- nespáruje. Porovnání patří do ingestního pruhu (advisory, jako
-- li_entity_suggestions), potvrzení výhradně člověku v kokpitu. Tyhle dvě
-- funkce jsou obě strany toho švu: co stojí za porovnání a jak se z nálezu
-- stane NÁVRH, který ctí dřívější lidské „ne".
\ir sql/functions/twin_identity_match_candidates.sql
\ir sql/functions/twin_identity_propose_match.sql
-- ⛔ A ať je PŘEVZETÍ KLÍČE vidět i na běžící instanci: fronta ratifikace teď
-- u návrhu říká, jestli tentýž klíč už potvrzeně patří JINÉMU dvojčeti. Obě
-- funkce dosud v heals nebyly, takže by změna žila jen v baseline (studený
-- start) a provoz by ji nikdy nedostal.
\ir sql/functions/twin_identity_list_unmatched.sql
\ir sql/functions/get_twin_identity_queue.sql

-- ── Kampaně: publikum podle SEKCE + zavřená stráž (2026-09-21) ──────────────
-- Dvě věci najednou, obě měřené:
--  1) `edge_notification_campaigns` byla SECURITY DEFINER s `GRANT … TO
--     authenticated` a BEZ jakékoli autorizace — každý přihlášený si mohl akcí
--     `get_all_profile_user_ids` vytáhnout seznam všech uživatelů instance.
--     Bylo to vedené jako známá výjimka; ruší se, protože skutečný volající je
--     jediný (worker svc-push pod service_role).
--  2) nové publikum `surface_section`: kampaň dostane ten, kdo sekci SMÍ VIDĚT
--     — rozhoduje `surface_audience_allows`, tedy TÝŽ predikát jako zobrazení
--     sekce. Oprávnění plyne z vazeb, ne z role.
-- Omezení `audience_type` se na běžící DB vyměňuje výslovným ALTER (CREATE TABLE
-- IF NOT EXISTS by neudělal nic), proto je soubor tabulky zapojený taky.
\ir sql/tables/notification_campaigns.sql
\ir sql/functions/edge_notification_campaigns.sql

-- ── PREDIKÁT O TŘETÍ OSOBĚ JE ORÁKULUM (2026-09-19, bezpečnost) ─────────────
-- Naměřeno na guru (jen čtení): katalogový dotaz — public, prosecdef, argument
-- user/uid/subject typu uuid, EXECUTE pro anon/authenticated — vrátil ~60 funkcí
-- a PostgREST je vystavuje jako /rpc/<jméno>. POST /rest/v1/rpc/has_role
-- s veřejným ANON klíčem a náhodným uuid → 200. Definer predikát, který pravdivě
-- odpovídá o CIZÍM uuid, vydá cizí vazby kus po kusu: účast ve story, souhlas
-- člen→partner (a zapsal audit pod cizím jménem), členství a odměny, admin roli.
--
-- Stráž „ptám se o sobě, nebo služba/správa" (predikát → false, zápis → 42501);
-- u is_user_admin / is_professional_partner / can_access_admin_section auth-first
-- COALESCE (fáze 2 brány security-hardened-helpers). REVOKE řešením NENÍ: RLS
-- predikát běží právy volajícího. Změřeno, že nic nerozbije: všech 10 volání
-- is_story_participant a 13 volání has_data_sharing_consent v politikách předává
-- auth.uid(); definer volající předávají proměnnou z auth.uid(); služby (reflect.ts,
-- dirigent-supervisor, toolExecutor, n8n) volají service klíčem.
-- fn_user_can_read_run má \ir výš (on-behalf-of autorizace) a nese tutéž stráž.
-- has_role / has_permission / is_story_partner dostaly stráž v #1045 (přenos z forku);
-- is_admin_or_staff(uuid) zůstává známou vadou (výjimka k-revizi v bráně) — tady se
-- jí záměrně nedotýkáme.
-- Třídu hlídá brána definer-subjekt-jen-volajici, chování test:db:subjekt.
-- Všech 12 opravených souborů dosud v heals nebylo (dluh heals-pokryva-sot) — bez
-- \ir by oprava žila jen v baseline a běžící instance by odpovídaly o cizích dál.
\ir sql/functions/is_story_participant.sql
\ir sql/functions/has_data_sharing_consent.sql
\ir sql/functions/can_receive_reward.sql
\ir sql/functions/can_access_linked_story.sql
\ir sql/functions/user_can_chat.sql
\ir sql/functions/user_has_admin_role.sql
\ir sql/functions/is_user_admin.sql
\ir sql/functions/get_user_sections.sql
\ir sql/functions/can_access_admin_section.sql
\ir sql/functions/should_auto_approve_order.sql
\ir sql/functions/is_professional_partner.sql
\ir sql/functions/insert_audit_journal_entry.sql
-- Tři funkce z téhož měření stráž v SoT MAJÍ (is_admin_or_staff / get_jwt_role,
-- nejpozději od 2026-06-20), ale jejich soubory v heals nebyly — běžící DB je tedy
-- nese jen tehdy, pokud poslední cold start proběhl po té změně. Živě to z této
-- relace změřit nešlo (giah nedostupný), proto \ir: stráž na běžící DB zaručí heals,
-- ne předpoklad o historii nasazení.
\ir sql/functions/audience_route_campaign_to_openclaw.sql
\ir sql/functions/audience_admin_send_test_campaign.sql
\ir sql/functions/get_session_monitoring_data.sql

-- ── 2026-09-21: texty obsahu smí zapsat i staff (editor plátna) ──────────────
-- `news_articles` spravuje admin NEBO staff (policy „Admin/staff can manage news"),
-- ale `upsert_translations` pouštěl jen admina — staff tedy uložil článek a jeho
-- texty se zahodily. Rozšířeno ÚZKĚ: staff jen obsahové namespacy
-- (web/news/pages/extranet), UI texty platformy zůstávají adminovi.
-- Soubor v heals dosud NEBYL, takže žádná změna téhle funkce se na běžící
-- databázi nikdy neprojevila — jen na čerstvé z baseline.
\ir sql/functions/upsert_translations.sql

-- ⭐ 2026-09-25 — klíče šifrování NEJSOU GUC (audit AUDIT-GUC-TAJEMSTVI).
-- NAMĚŘENO na dočasné DB z infra/postgres (produkční příkaz, sentinelové klíče):
-- `ALTER DATABASE postgres SET app.column_encryption_key / app.settings.vault_
-- encryption_key / app.settings.jwt_secret` přečetla KAŽDÁ role — 11 login rolí
-- i anon/authenticated/service_role — přes current_setting() i pg_db_role_setting
-- (sdílený katalog, tedy i z jiné DB clusteru); anon s klíčem dešifroval sloupec
-- mimo audit; PostgREST PGRST_APP_SETTINGS_* je vkládal do KAŽDÉHO požadavku.
-- Nově: entrypoint-wrapper.sh zapíše klíče do /run/aisha-keys (0400, postgres),
-- helpery je čtou pg_read_file jako vlastník, bez GRANTu komukoli; entrypoint
-- zároveň GUC na existující DB RESETuje. Hodnoty klíčů se NEMĚNÍ → šifrový text
-- (vault.secrets, *_enc sloupce) zůstává čitelný, nic se nepřešifrovává.
-- Pohled a funkce trezoru dosud žily jen v initdb skriptu (na běžící DB je
-- nic nepřehrálo) — domov mají teď v SoT, proto \ir tady. create/update_secret
-- navíc dostávají REVOKE FROM PUBLIC (dřív je směl spustit kdokoli s USAGE
-- na schématu vault — authenticated ho má).
-- Brány: klice-sifrovani-doruceni (kontrakt), tajemstvi-neni-guc (třída),
-- test:db:tajemstvi (čitelnost pod každou rolí).
\ir sql/functions/aisha_column_encryption_key.sql
\ir sql/functions/aisha_vault_encryption_key.sql
\ir sql/functions/vault_create_secret.sql
\ir sql/functions/vault_update_secret.sql
\ir sql/views/vault_decrypted_secrets.sql

-- ─── Federovaný zdroj — trezor relací uživatelů (ADR-004, PR A, 2026-09-25) ─────
-- Proč: broker volal zdroj za všechny JEDNÍM servisním účtem; zdroj identitu z těla
-- požadavku přepíše identitou tokenu, takže „federace" nejednala za nikoho (naměřeno
-- u prvního zdroje 23. 9.). Volat „jako uživatel" znamená držet token uživatele u zdroje
-- — a to je tajemství s plnými právy uživatele, u zdroje bez expirace platné, dokud ho
-- někdo výslovně neodhlásí. Revize rady aisha-team (7b model hrozeb, d8 kritéria bran)
-- a Aisha Guru (6 podmínek) jsou zapracované v ADR-004 rev. 4.
--  · šifruje BROKER (AES-256-GCM, klíč FEDERATION_VAULT_KEY mimo DB): klíče sloupců
--    i trezoru jsou v DB jako GUC čitelné relacemi, obecný decrypt pouští admin/staff;
--  · RLS bez policy + REVOKE; funkce SECURITY DEFINER se stráží is_service_role()
--    (role volajícího, ne current_user — uvnitř DEFINER je to vlastník);
--  · „jedna aktivní relace" a „účet zdroje jednou" drží unikátní částečné indexy;
--  · odvolání vždy + fronta odhlášení u zdroje nad týmiž řádky (nová fronta nevzniká);
--  · nonce toku a limit connect v DB — sdílené mezi replikami brokeru;
--    enforce_rate_limit_for je servisní a FAIL-CLOSED (enforce_rate_limit bez auth.uid()
--    tiše propustí). Úklid prošlých dělá tik plánovače brokeru pod advisory lockem.
-- Pořadí: tabulky (RLS v souboru tabulky) → rls → indexy → trigger → funkce.
\ir sql/tables/federated_source_sessions.sql
\ir sql/tables/federated_flow_nonces.sql
\ir sql/rls/federated_source_sessions.sql
\ir sql/indexes/federated_source_sessions_jedna_aktivni.sql
\ir sql/indexes/federated_source_sessions_ucet_zdroje_jednou.sql
\ir sql/indexes/federated_source_sessions_fronta_odhlaseni.sql
\ir sql/indexes/federated_flow_nonces_expires_at.sql
\ir sql/triggers/federated_source_sessions_updated_at.sql
\ir sql/functions/federated_source_session_put.sql
\ir sql/functions/federated_source_session_get_for_caller.sql
\ir sql/functions/federated_source_session_version.sql
\ir sql/functions/federated_source_session_revoke.sql
\ir sql/functions/federated_source_session_rotate.sql
\ir sql/functions/federated_source_session_logout_due.sql
\ir sql/functions/federated_source_session_logout_result.sql
\ir sql/functions/federated_flow_nonce_use.sql
\ir sql/functions/federated_flow_nonces_cleanup.sql
\ir sql/functions/enforce_rate_limit_for.sql
-- cleanup_old_rate_limits: úklid api_rate_limits volá tik údržby federace jako SERVIS; dosud byl
-- granted jen authenticated (servis ho volat nesměl) a bez stráže → stráž servis/admin + grant.
\ir sql/functions/cleanup_old_rate_limits.sql

NOTIFY pgrst, 'reload schema';

-- ── 2026-09-24: správa novinek — koncept vs. živá verze, historie, média, ohnisko ──
-- Naměřeno: veřejná stránka čte `canvas_html` přímo a editor plátna ukládá 5 s po
-- poslední změně, takže u ZVEŘEJNĚNÉHO článku šla každá nedopsaná věta na web.
-- Uložení zveřejněného článku jde nově do KONCEPTU (news_article_versions,
-- kind='draft'); „Zveřejnit změny" ho přelije do news_articles. Každé zveřejnění
-- a ruční uložení = verze k obnově (posledních 30 + všechna zveřejnění). Dva
-- editoři naráz: razítko (news_article_edit_stamp) → 409 místo tichého přepsání.
-- Titulní obrázek má ohnisko + přiblížení (výřez počítá doručení, obrázek se
-- nemění) a nahraná média mají evidenci (media_assets), protože úložiště výpis
-- neumí a umět nemá.
-- Pořadí: tabulky → indexy → politiky → pomocníci → zapisovatelé → čtenáři.
\ir sql/tables/news_articles.sql
\ir sql/tables/news_article_versions.sql
\ir sql/triggers/set_news_article_versions_updated_at.sql
\ir sql/tables/media_assets.sql
\ir sql/indexes/idx_news_article_versions_article.sql
\ir sql/indexes/uq_news_article_versions_draft.sql
\ir sql/indexes/idx_media_assets_created.sql
\ir sql/policies/news_article_versions_Admin_and_staff_can_read_article_versions.sql
\ir sql/policies/media_assets_Admin_and_staff_can_read_media_assets.sql
\ir sql/functions/news_article_texts.sql
\ir sql/functions/news_article_apply_texts.sql
\ir sql/functions/news_article_live_fields.sql
\ir sql/functions/news_article_check_fields.sql
\ir sql/functions/news_article_edit_stamp.sql
\ir sql/functions/create_news_article_version.sql
\ir sql/functions/get_news_article_versions.sql
\ir sql/functions/save_news_article_draft_admin.sql
\ir sql/functions/publish_news_article_admin.sql
\ir sql/functions/discard_news_article_draft_admin.sql
\ir sql/functions/restore_news_article_version.sql
-- Nový parametr nebo návratový typ = nový podpis. DROP starých přetížení je v SoT
-- souborech a zrcadlí se tady (heals-signature-drift), aby běžící DB neměla dvě
-- verze vedle sebe — PostgREST by volání s pojmenovanými argumenty odmítl.
DROP FUNCTION IF EXISTS public.update_news_article_canvas_admin(uuid, jsonb, text, text, boolean);
\ir sql/functions/update_news_article_canvas_admin.sql
DROP FUNCTION IF EXISTS public.update_news_article_admin(uuid, text, text, text, boolean, timestamptz, text, integer, text);
\ir sql/functions/update_news_article_admin.sql
DROP FUNCTION IF EXISTS public.create_news_article_admin(text, text, text, boolean, timestamptz, text, integer, text);
\ir sql/functions/create_news_article_admin.sql
DROP FUNCTION IF EXISTS public.get_news_article_admin(uuid);
\ir sql/functions/get_news_article_admin.sql
DROP FUNCTION IF EXISTS public.get_news_articles_admin();
\ir sql/functions/get_news_articles_admin.sql
DROP FUNCTION IF EXISTS public.get_news_article_by_slug(text);
\ir sql/functions/get_news_article_by_slug.sql
DROP FUNCTION IF EXISTS public.get_published_news_articles_filtered(text, text[], text, integer, integer, text);
\ir sql/functions/get_published_news_articles_filtered.sql
\ir sql/functions/record_media_asset.sql
\ir sql/functions/get_media_assets_admin.sql
\ir sql/functions/delete_media_asset_admin.sql

NOTIFY pgrst, 'reload schema';

-- ── Klasifikace zdroje: závora srovnaná s kontraktem (2026-09-20) ────────────
-- ⛔ NAMĚŘENO: `agent_knowledge_sources` vyžadovala k aktivaci `data_sensitivity`,
-- `legal_basis`, `owner`, `retention`, ale Source Onboarding Contract §1
-- předepisuje `source_type`, `data_sensitivity`, `retention_class`,
-- `legal_basis`. Kdo se řídil kontraktem, zdroj NEZAPNUL (`retention_class` se
-- do závory nepočítal); kdo se řídil závorou, zapnul ho BEZ `source_type` —
-- tedy bez dimenze, podle které §4 rozhoduje o souhlasu, DPA nebo oprávněném
-- zájmu. Rozhodnutí vlastníka: vyhrává kontrakt.
--
-- ⛔ PROČ TADY A NE JEN V SOUBORU TABULKY: `CREATE TABLE IF NOT EXISTS` na
-- existující DB neudělá nic, takže nové CHECKy by dosedly jen na čerstvou
-- databázi. Tohle je ta cesta, kterou oprava doteče do běžícího nasazení.
-- Idempotentní: DROP IF EXISTS + ADD, takže snese každý migrate.
--
-- ⛔ NAMĚŘENO 2026-09-25 (upgrade na datech předchozího mainu): jeden AKTIVNÍ
-- zdroj ve starém tvaru (`retention` místo `retention_class`, bez
-- `source_type` — stará závora ho pustila) shodil ADD CONSTRAINT níž, tím celý
-- migrate a s ním nasazení core (stejná třída jako #1061). „Selže nahlas" tu
-- znamenalo výpadek, ne hlášku.
--
-- Rozhodnutí správy repa (varianta B): zdroj, který novou závoru nesplní, se
-- PŘED přidáním závor VYPNE — fail-closed podle kontraktu (neklasifikovaný zdroj
-- nesmí běžet), ale nasazení projde. Vypnutí NENÍ tiché:
--   · důvod leží U DAT: `config.deaktivace` = {kdy, proc, kym, chybi,
--     neplatne_hodnoty, bylo_aktivni};
--   · řádek v `audit_journal` (action `agent_knowledge_sources.deaktivace_klasifikace`);
--   · RAISE WARNING do migrate logu.
-- Neplatná HODNOTA dimenze (např. `legal_basis: "test"`) by shodila hodnotový
-- CHECK i u vypnutého řádku — přesune se proto do `deaktivace.neplatne_hodnoty`
-- a z `config` zmizí; nic se neztratí, operátor ji vidí a doklasifikuje.
--
-- Idempotentní: vypnutý a vyčištěný řádek podmínku výběru už nesplní, takže
-- druhý běh nic nemění a nový audit nepíše. Na čisté instanci 0 řádků.
-- Operátor: doplní klasifikaci podle kontraktu, odebere `deaktivace` a zdroj
-- znovu zapne (závora ho pak pustí).
-- >>> heals #1063: klasifikace zdroje
DO $heal_1063$
DECLARE
  r            record;
  v_chybi      text[];
  v_neplatne   jsonb;
  v_proc       text;
  v_pocet      int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.source_slug, s.is_active, s.config
      FROM public.agent_knowledge_sources s
     WHERE (s.is_active AND NOT (s.config ? 'source_type' AND s.config ? 'data_sensitivity'
                                 AND s.config ? 'retention_class' AND s.config ? 'legal_basis'
                                 AND s.config ? 'owner'))
        OR (s.config ? 'source_type'
            AND s.config->>'source_type' NOT IN ('internal','partner','external','user_provided'))
        OR (s.config ? 'retention_class'
            AND s.config->>'retention_class' NOT IN ('ephemeral','short_term','long_term','permanent'))
        OR (s.config ? 'legal_basis'
            AND s.config->>'legal_basis' NOT IN ('consent','contract','legitimate_interest','legal_obligation'))
     ORDER BY s.source_slug
       FOR UPDATE
  LOOP
    v_chybi := ARRAY(
      SELECT k FROM unnest(ARRAY['source_type','data_sensitivity','retention_class','legal_basis','owner']) AS k
       WHERE NOT r.config ? k);
    v_neplatne := jsonb_strip_nulls(jsonb_build_object(
      'source_type', CASE WHEN r.config ? 'source_type'
        AND r.config->>'source_type' NOT IN ('internal','partner','external','user_provided')
        THEN r.config->'source_type' END,
      'retention_class', CASE WHEN r.config ? 'retention_class'
        AND r.config->>'retention_class' NOT IN ('ephemeral','short_term','long_term','permanent')
        THEN r.config->'retention_class' END,
      'legal_basis', CASE WHEN r.config ? 'legal_basis'
        AND r.config->>'legal_basis' NOT IN ('consent','contract','legitimate_interest','legal_obligation')
        THEN r.config->'legal_basis' END));
    v_proc := concat_ws('; ',
      CASE WHEN cardinality(v_chybi) > 0 THEN 'chybí ' || array_to_string(v_chybi, ', ') END,
      CASE WHEN v_neplatne <> '{}'::jsonb
        THEN 'neplatná hodnota ' || (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(v_neplatne) AS k) END);

    UPDATE public.agent_knowledge_sources
       SET is_active = false,
           config = (r.config - ARRAY(SELECT jsonb_object_keys(v_neplatne)))
                    || jsonb_build_object('deaktivace', jsonb_build_object(
                         'kdy', now(),
                         'proc', v_proc,
                         'kym', 'heals #1063',
                         'chybi', to_jsonb(v_chybi),
                         'neplatne_hodnoty', v_neplatne,
                         'bylo_aktivni', r.is_active))
     WHERE id = r.id;

    INSERT INTO public.audit_journal
      (user_id, action_type, action, entity_type, entity_id, area, severity, summary, metadata)
    VALUES
      (NULL, 'update', 'agent_knowledge_sources.deaktivace_klasifikace',
       'agent_knowledge_source', r.id::text, 'db', 'warning',
       format('Zdroj %s vypnut: %s (Source Onboarding Contract §1/§3)', r.source_slug, v_proc),
       jsonb_build_object('source_slug', r.source_slug, 'proc', v_proc, 'kym', 'heals #1063',
                          'chybi', to_jsonb(v_chybi), 'neplatne_hodnoty', v_neplatne,
                          'bylo_aktivni', r.is_active));

    RAISE WARNING 'heals #1063: zdroj % vypnut — %', r.source_slug, v_proc;
    v_pocet := v_pocet + 1;
  END LOOP;

  IF v_pocet > 0 THEN
    RAISE WARNING 'heals #1063: % zdroj(ů) vypnuto kvůli klasifikaci — důvod v config.deaktivace a audit_journal', v_pocet;
  END IF;
END
$heal_1063$;

ALTER TABLE public.agent_knowledge_sources
  DROP CONSTRAINT IF EXISTS agent_knowledge_sources_source_type_valid;
ALTER TABLE public.agent_knowledge_sources
  ADD CONSTRAINT agent_knowledge_sources_source_type_valid
  CHECK (NOT (config ? 'source_type')
         OR config->>'source_type' IN ('internal','partner','external','user_provided'));

ALTER TABLE public.agent_knowledge_sources
  DROP CONSTRAINT IF EXISTS agent_knowledge_sources_retention_class_valid;
ALTER TABLE public.agent_knowledge_sources
  ADD CONSTRAINT agent_knowledge_sources_retention_class_valid
  CHECK (NOT (config ? 'retention_class')
         OR config->>'retention_class' IN ('ephemeral','short_term','long_term','permanent'));

ALTER TABLE public.agent_knowledge_sources
  DROP CONSTRAINT IF EXISTS agent_knowledge_sources_legal_basis_valid;
ALTER TABLE public.agent_knowledge_sources
  ADD CONSTRAINT agent_knowledge_sources_legal_basis_valid
  CHECK (NOT (config ? 'legal_basis')
         OR config->>'legal_basis' IN ('consent','contract','legitimate_interest','legal_obligation'));

ALTER TABLE public.agent_knowledge_sources
  DROP CONSTRAINT IF EXISTS agent_knowledge_sources_activation_guard;
ALTER TABLE public.agent_knowledge_sources
  ADD CONSTRAINT agent_knowledge_sources_activation_guard
  CHECK (NOT is_active
         OR (config ? 'source_type' AND config ? 'data_sensitivity'
             AND config ? 'retention_class' AND config ? 'legal_basis'
             AND config ? 'owner'));
-- <<< heals #1063: klasifikace zdroje

COMMENT ON TABLE public.agent_knowledge_sources IS
  'SoT registry of knowledge sources. Activation requires the contract 4D classification (source_type, data_sensitivity, retention_class, legal_basis) plus owner in config — fail-closed.';

-- ⭐ HR „LIDÉ A ÚČTY" (2026-09-23, zadání majitele: „účty v KC propojujeme
-- s entitami z twinverse"). Obrazovka nad EXISTUJÍCÍ cestou vazeb, žádná nová:
--   · hr_ucty_admin        — účty (profiles) a osoba, na kterou jsou navázané
--                            (odvozené z potvrzené a platné `account` vazby),
--   · hr_prirad_ucet_admin — twin_identity_propose_binding + _confirm_binding
--                            v JEDNÉ transakci; účet smí přejít k jiné osobě
--                            (historie zůstane), osobu s jiným účtem nepřebírá,
--   · hr_odvaz_ucet_admin  — konec platnosti účtové vazby (nic se nemaže).
-- twin_accounts_missing.sql se znovu NEUVÁDÍ: jeho \ir výš přehraje novou verzi
-- (hledání na serveru, úkoly na osobu, `limitovano`; stará dvouargumentová
-- signatura se v souboru ruší — jinak by volání bylo nejednoznačné, 42725).
-- Výslovný DROP i tady: \ir výš novou signaturu vytvoří, ale na UŽ běžící DB
-- musí stará zmizet — brána heals-signature-drift chce DROP + \ir v heals.
DROP FUNCTION IF EXISTS public.twin_accounts_missing(text, integer);
\ir sql/functions/hr_ucty_admin.sql
\ir sql/functions/hr_prirad_ucet_admin.sql
\ir sql/functions/hr_odvaz_ucet_admin.sql

-- ── 2026-09-23: karta protistrany — twin firmy, finance a síť vazeb ──
-- Proklik na dlužníka i na nájemce otevírá TUTÉŽ kartu: counterparty_resolve
-- rozřeší {debtor} i {twin_id} na identitu v modelu (twiny firmy × IČO × jména
-- z dokladů). Naměřeno na <fork>-instanci: ze 102 dlužníků po splatnosti má jediný twin
-- jen 27, 42 jich má víc twinů (duplicita ingestů), 33 žádný — karta to ukáže.
-- Síť vazeb (relation_web, ESDK es-web) nese jistotu vazby v datech; tabulka
-- twin_relations je dnes prázdná, vazby se skládají z parametrů a návrhů.
-- Indexy: hledání dokladů podle IČO/jména místo průchodu celou evidencí.
-- 2026-09-29: expresní indexy nad `fields` nahradily indexy nad generovanými sloupci
-- (výš, u counterparty_labels) — pod RLS je planner nepoužil nikdy, jen je udržoval.
DROP INDEX IF EXISTS public.idx_li_source_registry_counterparty_id;
DROP INDEX IF EXISTS public.idx_li_source_registry_counterparty;
\ir sql/functions/counterparty_resolve.sql
\ir sql/functions/counterparty_docs.sql
-- 2026-09-26: smlouvy protistrany jednou odpovědí pro kartu i síť vazeb
\ir sql/functions/counterparty_contracts.sql
-- 2026-09-28: vztah protistrany v čase (role × období, doklady bez stavu úhrady)
-- jednou odpovědí pro kartu i Ask. DŘÍV než karta — SQL tělo karty ho volá.
\ir sql/functions/counterparty_periods.sql
\ir sql/functions/get_counterparty_card.sql
\ir sql/functions/get_counterparty_metric.sql
\ir sql/functions/get_counterparty_aging.sql
\ir sql/functions/get_counterparty_trend.sql
\ir sql/functions/get_counterparty_web.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ HR SJEDNOCENÍ OSOBY (2026-09-23, rozhodnutí majitele: „kokpit ingestu
-- navrhuje vazby, … ale HR spojuje nález s člověkem / přístupem, resp.
-- identitou"). Naměřeno týž den: 1 487 twinů `driver` na ~47 řidičů.
--   · hr_sjednot_osobu_admin — úlomky pod kanonickou osobu: vazby převést
--     (ingest se tím učí — upsert hledá twin přes primární vazbu), čekající
--     úkoly přepojit, úlomky archivovat, jméno zamknout; náhled výchozí,
--     rozhodnutí = řádek audit_journal `twin_decision`, vratné.
-- Znovu se NEUVÁDÍ (jejich \ir výš přehraje novou verzi):
--   · revert_twin_decision_admin — nový typ `twin.person_unified`,
--   · twin_upsert_entity_audited — nepřepíše jméno s `label_hr` a značky
--     rozhodnutí přežijí náhradu metadat.
\ir sql/functions/hr_sjednot_osobu_admin.sql
-- Nabídka druhů pro filtr HR (naměřeno po nasazení: bez ní „driver" v nabídce
-- chyběl, když byly abecedně napřed firmy) — odvozená z dat, nic natvrdo.
\ir sql/functions/hr_druhy_osob_admin.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ DEKLARACE ZAŘÍZENÍ V DATABÁZI (2026-09-24, rozhodnutí majitele: „je třeba, aby
-- se spustil build, který balíček nahraje do storage automaticky, aby uživatel
-- nemusel"). Deklarace (Kiosk Admin + rozdávané appky) dosud vedla trezor → env
-- `ZARIZENI_HLIDAC`; trezor je mimo CI, takže „samo po vyžádání" by na něm končilo
-- ručním zápisem. Hák dat instance ji sem zapíše 1:1 (`NN_zarizeni_deklarace.sql`
-- v datech instance), storage-auth ji čte RPC za běhu. Jen service role.
\ir sql/tables/zarizeni_deklarace.sql
\ir sql/functions/zarizeni_deklarace_zapis.sql
\ir sql/functions/zarizeni_deklarace_cteni.sql

-- ─── 2026-09-25: fronta předání čte živý stav ze zdroje, ne zmrazenou kopii ──
-- `get_workflow_my_steps_block` se nově doptává registru přes ukazatel
-- `input_data->>'doc_slug'`, a kde ukazatel nic nenajde, přes identitu dokladu
-- ve zdroji (`source_state.stable_key` — jméno pole je DATA instance, proto
-- obecný GIN nad `fields`, ne výraz s jménem pole). Funkce samotná se sem
-- dodávat nemusí — `\ir` na ni je výš (ř. 8505 a 8608) a přehraje novou verzi.
-- INDEXY ale ano: baseline se na už inicializované databázi znovu neaplikuje,
-- takže bez těchhle dvou řádků by nová verze funkce běžela nad neindexovaným
-- registrem. Změřeno na čerstvém baseline 2026-09-25: li_source_registry má
-- 8 indexů a ani jeden nesahá na `doc_slug` ani na pole identity, takže laterál
-- při stropu 200 položek dělá 200 sekvenčních průchodů přes ~43 tis. řádků.
\ir sql/indexes/idx_li_source_registry_doc_slug_valid.sql
\ir sql/indexes/idx_li_source_registry_fields_gin.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ SCHVÁLENÍ PLUGINU V ADMINISTRACI (2026-09-26). Naměřeno v produkci instance:
-- zdroje aktivní, pověření vyplněná, pluginy člověkem dvakrát posunuté do `ga` —
-- a po dalším nasazení s novým kódem znovu `submitted` (správně: schválení drží
-- jen shodný otisk artefaktu). Znovu schválit ale nebylo kde: transition_plugin_status
-- nevolalo nic. Tohle je druhá půlka pojistky — úkon správce z plochy.
\ir sql/functions/approve_internal_plugin.sql
-- Kam smí schválený plugin volat — z JEHO sandbox politiky, ne z prázdných
-- proměnných služby (naměřeno: PLUGIN_NETWORK_ALLOWLIST/PLUGIN_RPC_WHITELIST
-- prázdné → každé volání dodavatele i každý zápis by skončil 403).
\ir sql/functions/get_plugin_sandbox_policy.sql

-- ── Vlastnictví záznamů v upsertech s globálním klíčem (2026-09-29) ────────────
-- Třída: `ON CONFLICT (<globální klíč>) DO UPDATE` přepsal vlastníka / cíl cizího
-- záznamu. Existující záznam teď mění jen týž vlastník (jinak 42501); u změny cíle
-- se pověření nepřevezme. Funkce dosud v heals nebyly (přiznaný dluh v
-- heals-pokryva-sot) → oprava by jinak platila jen na studeném startu.
\ir sql/functions/upsert_web_push_subscription.sql
\ir sql/functions/upsert_integration_service.sql
\ir sql/functions/aisha_register_mcp_server.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ enqueue_agent_run JEN PRO SLUŽBY (2026-09-27). Naměřeno na instanci: funkce byla
-- udělená `authenticated`, ne `service_role`. Runner ji volá služebním tokenem → 403 →
-- každý běh pluginu končil „Agent runner error 500" (pluginy vozového parku po opravě
-- artefaktu). A přihlášený uživatel si mohl přímo zařadit běh s VLASTNÍM obrazem, který
-- poller runneru spouští (u instancí s CLAUDE_POLL_ENABLED). Teď jen service_role;
-- grant pro authenticated/anon se výslovně odebírá (CREATE OR REPLACE ho neodebere).
\ir sql/functions/enqueue_agent_run.sql

-- ⭐ KOTVA BĚHU KE STORY: JEDEN TRIGGER, BEZ HLÍDANÉ RPC (2026-09-27). Naměřeno na
-- čistém mainu: 3 agentní runtime testy (route_task call-mode partnera) padaly na
-- „Unauthorized: admin/staff or service_role required" — trigger ai_runs_default_story
-- (2026-07-26) volal ensure_stack_default_story() pod claims VOLAJÍCÍHO a od totálních
-- guardů (2026-08-04) odmítl každého zapisovatele bez správcovské role. V produkci
-- instance leželi na ai_runs DVA triggery téhož účelu (+ trg_ai_runs_default_system_story
-- z 2026-06-22, jen v baseline, sem nikdy nezapojený). Teď jeden: vyhledání singletonu,
-- který zakládá seed; chybí-li, chyba nahlas.
DROP TRIGGER IF EXISTS trg_ai_runs_default_system_story ON public.ai_runs;
DROP FUNCTION IF EXISTS public.fn_ai_runs_default_system_story();
\ir sql/functions/fn_ai_runs_default_story.sql
\ir sql/triggers/ai_runs_default_story.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ SNÍMEK VÝKONU AGENTA (2026-09-28, SELF_IMPROVEMENT_LOOP.md K-01). Funkce v heals
-- NIKDY nebyla — běžící DB tak držela verzi, která spojovala `ai_eval_runs.run_id`
-- (sloupec neexistuje) a padala při každém volání. Naměřeno na main 9087ef3df:
-- WF_IMPROVEMENT_EVAL (vyhodnocení změny po 24 h) i WF_MODEL_ADVISORY (týdenní rada
-- k modelu) snímek nikdy nedostaly. Nová verze: kvalita přes ai_golden_examples.agent_slug,
-- null = neměřeno (dřív 0 → falešná regrese a rollback), `total_events` i nahoře
-- (poradce ho četl odtud a viděl vždy 0), stráž služba/správa (dřív orákulum).
\ir sql/functions/fn_get_agent_performance_snapshot.sql

-- ⛔ NEŠIFROVANÁ TAJEMSTVÍ V app_secrets (2026-09-28, změřeno na riq): tabulka měla
-- SELECT pro anon a ALL pro authenticated; chránila ji jen RLS politika „admin" —
-- admin (i útok přes jeho relaci) četl hodnoty přes /rest/v1/app_secrets.
-- set_api_key_admin do ní psal nešifrovanou kopii a get_app_secret/_batch ji četly.
-- Pořadí je význam: granty pryč → převod do trezoru (idempotentní, nic nemaže)
-- → teprve pak čtenáři přepnutí na trezor, ať nenajdou prázdno. Vše PO funkcích
-- trezoru výš (vault_create_secret, vault_decrypted_secrets).
\ir sql/grants/app_secrets.sql
\ir sql/functions/migrate_app_secrets_to_vault.sql
SELECT public.migrate_app_secrets_to_vault() AS app_secrets_prevedeno_do_trezoru;
\ir sql/functions/get_app_secret.sql
\ir sql/functions/get_app_secrets_batch.sql
\ir sql/functions/get_github_app_secrets_from_vault.sql
\ir sql/functions/set_api_key_admin.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ JÍZDY ZDROJŮ → UDÁLOSTI DVOJČAT (2026-09-26). Naměřeno v produkci instance:
-- 12 dvojčat vozidel (z ingestu), 0 událostí 'trip' — žádná jízda žádného zdroje
-- se na dvojčata nikdy nedostala, dlaždice vozového parku proto ukazují NEMĚŘENO.
-- Obecné jádro (návrhy vazeb ze shody signálů + projekce jízd) a tenké adaptéry
-- T-cars; přepojení zdroje na source_catalog_rows = nový adaptér, jádro zůstane.
\ir sql/functions/twin_propose_identity_by_signals.sql
\ir sql/functions/twin_project_trips.sql
\ir sql/functions/tc_propose_identity.sql
\ir sql/functions/tc_project_rides.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ AUTORITA ZDROJE U ADITIVNÍCH VELIČIN (2026-09-26). twin_param_values (\ir
-- výš) nově počítá u součtových veličin jen události zdroje, kterého jmenuje
-- katalog — jinak by jízdu hlášenou dvěma dodavateli sečetl dvakrát. Proč je
-- veličina NEMĚŘENO (zdroj nic nezapsal / katalog jmenuje neexistující zdroj),
-- říká nahlas tahle funkce.
\ir sql/functions/twin_catalog_source_findings.sql

-- ⭐ UDÁLOSTI ZDROJŮ → DVOJČATA: OBECNÉ JÁDRO + TANKOVÁNÍ AVP (2026-09-27).
-- Jízdy, tankování i tachograf jsou tentýž tvar (kdo, s kým, kdy, co) —
-- jedno jádro projekce s kontrolou DRUHU entity (vazba identity je dnes
-- jedinečná bez něj; nalezeno u T-cars), twin_project_trips (\ir výš) je jeho
-- obal. AVP: výdeje z obecné surové dráhy → 'fueling' (litry jen platná verze
-- řetězu oprav), návrhy vazeb karet a čipů. Nic nezakládá dvojčata.
-- (twin_project_trips.sql se přehrává výš, v bloku jízd — PL/pgSQL volanou
-- funkci dohledá až za běhu, pořadí tedy nevadí.)
\ir sql/functions/twin_project_events.sql
\ir sql/functions/avp_propose_identity.sql
\ir sql/functions/avp_project_fuelings.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ WEBDISPEČINK → DVOJČATA (2026-09-27). Jízdy (wd_rides) a denní výkony
-- řidičů z tachografu (wd_worktime), které plugin už stahuje, se promítají
-- obecným jádrem (twin_project_trips / twin_project_events) — jen přes
-- POTVRZENÉ vazby, zdroj identity 'webdispecink', řidič 'ridic:<id>'. Místa
-- jízd se nepřenáší. Návrhy vazeb z číselníků WD.
\ir sql/functions/wd_propose_identity.sql
\ir sql/functions/wd_project_rides.sql
\ir sql/functions/wd_project_worktime.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ EUROWAG → DVOJČATA (2026-09-27). Plugin 0.2.0 ukládá na obecnou surovou
-- dráhu (source_catalog_rows) místo zakládání dvojčat; jízdy a stavy vozidel
-- (bez polohy) promítá obecné jádro jen přes POTVRZENÉ vazby, klíče s druhem
-- ('vozidlo:' / 'osoba:'). Návrhy vazeb z číselníků Eurowagu.
\ir sql/functions/ew_propose_identity.sql
\ir sql/functions/ew_project_catalog.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ enqueue_agent_run JEN PRO SLUŽBY (2026-09-27). Naměřeno na instanci: funkce byla
-- udělená `authenticated`, ne `service_role`. Runner ji volá služebním tokenem → 403 →
-- každý běh pluginu končil „Agent runner error 500" (pluginy vozového parku po opravě
-- artefaktu). A přihlášený uživatel si mohl přímo zařadit běh s VLASTNÍM obrazem, který
-- poller runneru spouští (u instancí s CLAUDE_POLL_ENABLED). Teď jen service_role;
-- grant pro authenticated/anon se výslovně odebírá (CREATE OR REPLACE ho neodebere).
\ir sql/functions/enqueue_agent_run.sql

-- ⭐ KOTVA BĚHU KE STORY: JEDEN TRIGGER, BEZ HLÍDANÉ RPC (2026-09-27). Naměřeno na
-- čistém mainu: 3 agentní runtime testy (route_task call-mode partnera) padaly na
-- „Unauthorized: admin/staff or service_role required" — trigger ai_runs_default_story
-- (2026-07-26) volal ensure_stack_default_story() pod claims VOLAJÍCÍHO a od totálních
-- guardů (2026-08-04) odmítl každého zapisovatele bez správcovské role. V produkci
-- instance leželi na ai_runs DVA triggery téhož účelu (+ trg_ai_runs_default_system_story
-- z 2026-06-22, jen v baseline, sem nikdy nezapojený). Teď jeden: vyhledání singletonu,
-- který zakládá seed; chybí-li, chyba nahlas.
DROP TRIGGER IF EXISTS trg_ai_runs_default_system_story ON public.ai_runs;
DROP FUNCTION IF EXISTS public.fn_ai_runs_default_system_story();
\ir sql/functions/fn_ai_runs_default_story.sql
\ir sql/triggers/ai_runs_default_story.sql

-- ⭐ NÁROK Z VAZEB (rozhodnutí majitele 2026-09-28). Běžný uživatel má vidět
-- smlouvy, faktury a dlužníky jen z identit, se kterými je spojen: účet → osoba
-- (potvrzená vazba účtu) → platná vazba osoby na identitu → potvrzený
-- identifikátor identity == pole dokladu. Jak vazba zakládá nárok, říkají data
-- instance (twin_scope_doc_rules; prázdno = nikdo nic). Nové množinové členy
-- politik dokladů a dvojčat; bez vazby se nic nemění (řidič, správa). Naměřeno
-- v produkci: 23 bloků Smluv je SECURITY INVOKER — nárok zdědí bez změny čteček.
-- Klíče dokladů jsou PŘEDPOČÍTANÉ (li_doc_scope_keys, trigger na registru,
-- přestavba při změně pravidel): párování nad fields stálo na produkci
-- 201–1 353 ms na dotaz, a nárok je člen politiky.
\ir sql/tables/twin_scope_doc_rules.sql
\ir sql/tables/li_doc_scope_keys.sql
\ir sql/indexes/idx_li_doc_scope_keys_hodnota.sql
\ir sql/indexes/idx_li_doc_scope_keys_doc_slug.sql
\ir sql/functions/li_doc_scope_keys_z_dokladu.sql
\ir sql/functions/li_doc_scope_keys_prestav.sql
\ir sql/functions/fn_li_source_registry_scope_keys.sql
\ir sql/functions/fn_twin_scope_doc_rules_prestav.sql
\ir sql/triggers/li_source_registry_scope_keys.sql
\ir sql/triggers/twin_scope_doc_rules_prestav.sql
\ir sql/triggers/update_twin_scope_doc_rules_updated_at.sql
\ir sql/functions/li_doc_slugs_v_rozsahu.sql
\ir sql/functions/twin_ids_v_rozsahu.sql
\ir sql/policies/li_source_registry_read.sql
\ir sql/policies/twin_entities_read.sql
\ir sql/policies/twin_external_refs_read.sql
\ir sql/policies/twin_relations_read.sql
-- Konvergence: klíče z celého registru i kdyby trigger někdy chyběl (bez pravidel
-- nic nezapíše; s pravidly ~ jednotky sekund).
SELECT public.li_doc_scope_keys_prestav();

NOTIFY pgrst, 'reload schema';

-- ⭐ PŘÍSTUP DO SEKCE U UŽIVATELE (rozhodnutí majitele 2026-09-28): „přístup
-- k datům z úhlu pohledu je jedna věc, přístup do sekce extranetu je další
-- úroveň" — udělení se nastavuje v administraci u uživatele, ne rolí (app_role
-- je pevný výčet stacku, jméno sekce je slovník instance). Nová osa publika
-- `"udeleni": "<sekce>"` v JEDINÉM interpretu (surface_audience_allows), takže
-- menu, RLS umístění i get_block_data se řídí týmž pravidlem beze změny volajících.
-- Sonda dat: sekci, ve které běžný uživatel nic nemá, list_surface_sections
-- neukáže („není potřeba, aby ji viděl, byť do ní má přístup").
\ir sql/tables/surface_section_grants.sql
\ir sql/tables/surface_sections.sql
\ir sql/functions/surface_audience_allows.sql
\ir sql/functions/surface_presence_ok.sql
\ir sql/functions/list_surface_sections.sql
\ir sql/functions/surface_udel_admin.sql
\ir sql/functions/surface_udeleni_admin.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ VAZBY NA DATA V LIDÉ A ÚČTY (rozhodnutí majitele 2026-09-28): „k čemu
-- v extranetu a vazby na data se uživatel dostane" nastavuje správa u uživatele.
-- Sekce = udělení (surface_udel_admin), data = vazba osoby účtu na identitu druhem
-- z pravidel nároku. Obaly nad twin_ensure_for_account a twin_relation_open/close
-- (audit), přehled a hledání identit s počtem potvrzených identifikátorů.
\ir sql/functions/hr_vazby_uctu_admin.sql
\ir sql/functions/hr_identity_hledat_admin.sql
\ir sql/functions/hr_prirad_identitu_admin.sql
\ir sql/functions/hr_odeber_identitu_admin.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ ZDROJE DAT U UŽIVATELE (rozhodnutí majitele 2026-09-28): „ingest navrhuje vazby,
-- protistrany… ale neměl by řešit, kdo k čemu má přístup; MODĚVA, Avant… to jsou zdroje
-- dat z Money, které chceme zpřístupnit". Přístup ke zdroji uděluje správa u uživatele
-- (data_source_grants), sekce zvlášť. Zdroj dokladu je jeho PŮVOD, ne pole vytažené
-- ingestem: instance zdroje ze záznamu konektoru (`source_record._instance` — naměřeno:
-- 44 790 dokladů Money z 5 instancí), adresář ve vstupu ingestu (raw_data.source_path)
-- a firma = IČO smluvní strany smluvního dokumentu („vazba na firmy, které vidíme v přehledu“;
-- naměřeno: Moravská nemovitostní stranou 136 smluv).
-- Klíče původu počítá li_doc_scope_keys_z_dokladu (nový podpis s raw_data, přehraný už
-- v předpokladech výš i v bloku nároku) a přestavba v bloku nároku; tady tabulka udělení,
-- správa v Lidé a účty a úklid starého podpisu až PO přehrání jeho volajících.
\ir sql/tables/data_source_grants.sql
\ir sql/functions/hr_zdroje_uctu_admin.sql
\ir sql/functions/hr_udel_zdroj_admin.sql
DROP FUNCTION IF EXISTS public.li_doc_scope_keys_z_dokladu(text, jsonb);
DROP FUNCTION IF EXISTS public.li_doc_scope_keys_z_dokladu(text, jsonb, jsonb);

NOTIFY pgrst, 'reload schema';

-- ⭐ ASK: FIRMA Z TEXTU OTÁZKY (naměřeno 2026-09-28): „Co víme o firmě SFR Motor s.r.o.?"
-- odpovídalo o „SFR Motor SERVIS s.r.o." (jiná firma, jen přijaté faktury → „vydané
-- faktury nemáme"). Dohad bral nejdelší shodné slovo a při shodě DELŠÍ název, i když
-- jeho slovo v otázce není. Nově má přednost celý název v otázce, pak nejméně
-- chybějících slov názvu. (Soubor se přehrává i výš v chronologii; tady jen důvod.)
\ir sql/functions/answer_verified_facts.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ PLNÝ PŘÍSTUP K DATŮM A DETAIL JEDNOTKY (rozhodnutí majitele 2026-09-28): „pokud mám
-- přístup do sekce, měl bych vidět veškerý obsah, ke kterému mám právo… možnost bez omezení,
-- ne s výběrem, kdo se o nájemce stará; možnost omezit chceme zachovat". Zdroj `vse:*`
-- (Lidé a účty → Zdroje dat → Všechna data) otevře všechny doklady a dvojčata jedním
-- InitPlan členem čtecích politik (registr, dvojčata, identifikátory mimo vazby účtů,
-- vazby, parametry v čase, katalog parametrů). Správu nedává — sekce se udělují zvlášť.
-- Funkce je výš i v předpokladech před prvním přehráním politik (lekce z 2026-09-28).
-- Detail dvojčete nově ukazuje poslední parametry v čase (nájemce, obsazenost jednotky)
-- ze stejného zdroje jako registr: naměřeno, že detail jednotky nájemce neukazoval vůbec.
\ir sql/tables/data_source_grants.sql
\ir sql/functions/ma_plny_pristup_k_datum.sql
\ir sql/functions/hr_zdroje_uctu_admin.sql
\ir sql/functions/hr_udel_zdroj_admin.sql
\ir sql/functions/get_twin_detail.sql
\ir sql/policies/li_source_registry_read.sql
\ir sql/policies/twin_entities_read.sql
\ir sql/policies/twin_external_refs_read.sql
\ir sql/policies/twin_relations_read.sql
\ir sql/policies/twin_events_read.sql
\ir sql/policies/twin_parameter_definitions_read.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ NOVÉ AGENDY → NÁVRH „NAŠE FIRMA" (rozhodnutí majitele 2026-09-28): „až příště přidáme
-- novou agendu z Money… aby nám to odhalil a doporučil ve správě ingestu a stačilo to jen
-- potvrdit". Instance zdroje, která se poprvé objeví v klíčích původu, dostane návrh
-- twin_external_refs `nase_firma` (proposed) na firmě téhož jména (jinak se firma založí);
-- schvaluje člověk jedním potvrzením ve frontě identifikátorů, potvrzený název je schválený
-- název firmy. Trigger po příkazu nad li_doc_scope_keys; jednorázově i pro instance, které
-- už v datech jsou (idempotentní — o čem se rozhodlo, se znovu nenavrhne).
\ir sql/functions/navrhni_nase_firmy_z_agend.sql
\ir sql/functions/fn_li_doc_scope_keys_nase_firmy.sql
\ir sql/triggers/li_doc_scope_keys_nase_firmy.sql
\ir sql/functions/counterparty_resolve.sql
\ir sql/functions/get_counterparty_card.sql
SELECT public.navrhni_nase_firmy_z_agend();

NOTIFY pgrst, 'reload schema';

-- ⭐ TABLET SE OHLÁSÍ SÁM A SCHVÁLENÍ PLATÍ BEZ RUČNÍHO EXPORTU (2026-09-28).
-- Majitel: „po kliknutí na zavedení zařízení se klíč odešle na backend, protože je
-- odemčeno, a následně to zařízení můžeme permanentně v administraci schválit,
-- aby si tablet mohl ťukat sám" a „to zařízení samozřejmě musí umět samo klepat,
-- když je schválené".
-- Změřeno 28. 9.: „Zavést toto zařízení" klíč jen vyrobil — `register_knock_device`
-- chce přihlášeného člověka, tablet v kiosku nikoho nemá, v administraci nebylo
-- co schválit; a roster dveří (env SPA_OPERATORS_B64) nesl 2 kódy techniků a
-- 0 klíčů zařízení, protože export ze schválených průkazů byl ruční.
-- Tabulka (druh 'tablet', adresa, verze) a seznam pro správu se přehrávají výš
-- ve svém bloku; tady jen nové RPC pro bránu (ohlášení, stav, roster dveří).
-- admin_list_knock_devices má nový tvar (druh, ohlaseno_z_ip, verze) a filtr p_druh:
-- jednoparametrové přetížení (uuid) se zahodí i na běžících instancích (jiná arita).
DROP FUNCTION IF EXISTS public.admin_list_knock_devices(uuid);
\ir sql/functions/admin_list_knock_devices.sql
\ir sql/functions/enrol_kiosk_device.sql
\ir sql/functions/kiosk_device_stav.sql
\ir sql/functions/knock_roster_zarizeni.sql

NOTIFY pgrst, 'reload schema';
-- ⭐ VŠECHNA DATA PO ZDROJÍCH (rozhodnutí majitele 2026-09-28): „chceme zapnout všechna data,
-- ale rozdělená po zdrojích — Money už máme, teď nám jde o dokumenty, smlouvy… resp. data
-- přes ingest, co z toho přišlo". Nové druhy udělení:
--   vstup:dokumenty  — dokumenty zpracovaného vstupu ingestu (klíč původu `@vstup`; naměřeno
--                      1 023: 813 smluv, 114 dodatků, 94 faktur v PDF, 2 vyúčtování),
--   udalosti:<zdroj> — dvojčata, o kterých nese data zdroj (twin_events.source; naměřeno
--                      sez-vyuctovani 121 jednotek, ares 70 firem nájemců).
-- Parametry v čase čte, kdo smí číst dvojče (twin_ids_v_rozsahu), katalog parametrů kdo má
-- aspoň jeden zdroj (ma_zdroj_dat). Klíče dokladů se přestaví výš (přestavba v bloku nároku).
\ir sql/tables/data_source_grants.sql
\ir sql/functions/ma_zdroj_dat.sql
\ir sql/functions/li_doc_scope_keys_z_dokladu.sql
\ir sql/functions/twin_ids_v_rozsahu.sql
\ir sql/functions/hr_zdroje_uctu_admin.sql
\ir sql/functions/hr_udel_zdroj_admin.sql
\ir sql/policies/twin_events_read.sql
\ir sql/policies/twin_parameter_definitions_read.sql
SELECT public.li_doc_scope_keys_prestav();

NOTIFY pgrst, 'reload schema';


-- ⭐ NÁLEZY JAKO DOTAZY NA PRAVDU (2026-09-28). Blok „Nálezy" ukazoval jeden řádek
-- na doklad (79× dvě tytéž věty), bez čísel a bez akce — „nevím k čemu to je a nejde
-- s tím nic dělat". Nálezy se teď slučují po pravidlech do dotazu s příkladem
-- (get_finding_questions) a odpověď se zapisuje verdiktem nad pravidlem
-- (li_finding_verdicts, větev 'finding' v submit_evidence_review_audited — ta se
-- tu znovu neuvádí, dřívější \ir přehrávají aktuální soubor; plpgsql váže tabulku
-- až za běhu). Tabulka MUSÍ být před get_finding_questions: je to SQL funkce,
-- jejíž tělo se při vytvoření ověřuje.
\ir sql/tables/li_finding_verdicts.sql
\ir sql/policies/li_finding_verdicts_admin_select.sql
\ir sql/policies/li_finding_verdicts_service_all.sql
\ir sql/functions/li_finding_question_id.sql
\ir sql/functions/li_finding_is_current.sql
\ir sql/functions/li_finding_field.sql
\ir sql/functions/li_finding_evidence_fields.sql
\ir sql/functions/get_finding_questions.sql

-- ⭐ F2 TABLETŮ — VLASTNÍ ÚČET A ROZSAH (2026-09-29; majitel: „tablet nabídne dnešní rozvozy
-- naší dopravy podle řidiče i podle vozidla, bez osobních údajů“; revize Aisha Guru 29. 9.).
-- Naměřeno v kódu: handle_new_user dával KAŽDÉMU účtu `member` bez přepínače; vazba přes dvojče
-- tablet nepokryje (jeden účet na dvojče). Proto: účet zařízení zakládá JEN definer při schválení
-- (vazba knock_device_credentials.ucet_id zapsaná DŘÍV než uživatel → handle_new_user roli
-- nepřidá), pátá cesta workflow_step_visible_to podle `kiosk_rozsah` (DATA instance) s kontrolou
-- platného průkazu při KAŽDÉM volání. Upravené funkce (handle_new_user, workflow_step_visible_to,
-- admin_set_knock_device_approval, complete_workflow_step, submit_evidence_review_audited) se
-- přehrávají na svých místech výš (plpgsql — odkazy na objekty níž se řeší za běhu).
\ir sql/tables/kiosk_rozsah.sql
\ir sql/indexes/uq_knock_device_credentials_ucet.sql
\ir sql/functions/je_ucet_zarizeni_platny.sql
\ir sql/functions/current_device_kid.sql
\ir sql/functions/zaloz_ucet_zarizeni_interni.sql
-- Dorovnání: tablety SCHVÁLENÉ před F2 účet nemají. Založí se touž definer cestou (strana
-- serveru, idempotentně) — jinak by si tablet po nasazení F2 relaci nevzal, dokud ho správce
-- neschválí znovu. Odvolané a čekající se nezakládají.
DO $f2_dorovnani$
DECLARE r record;
BEGIN
  FOR r IN SELECT kid FROM public.knock_device_credentials
            WHERE druh = 'tablet' AND approved_at IS NOT NULL AND revoked_at IS NULL AND ucet_id IS NULL
  LOOP
    PERFORM public.zaloz_ucet_zarizeni_interni(r.kid);
  END LOOP;
END $f2_dorovnani$;

NOTIFY pgrst, 'reload schema';

-- ⭐ F2-B/F2-C TABLETŮ — RELACE A DNEŠNÍ ROZVOZY (2026-09-29; majitel: „po validaci … podpis
-- resp. klepání odemyká … a následně je možnost se dostat do aplikace bez přihlášení pouze
-- k našim dodákům“; klíč zůstává z ohlášení, Keystore je navazující úkol).
-- kiosk_vydej_relaci volá JEN gateway, a to AŽ PO ověření podpisu (zápis auditu nespustí,
-- kdo klíč nedrží). kiosk_projekce je JEDINÉ pravidlo, co z kroku smí na tablet (`pole`
-- rozsahu). get_kiosk_rozvozy = výběr podle řidiče/vozidla (tahač) + seznam předání.
-- Naměřeno v kódu: get_workflow_step_detail a workflow_step_derived_position volaly predikát
-- BEZ kódu kroku (pátá cesta by tablet nepustila) a detail vracel celé input_data, output_data
-- (přebírající z dřívějšího potvrzení) i název běhu „{odběratel} — {DL}“ — obě funkce se
-- přehrávají na svých místech výš a nově předávají step_code a tabletu vydávají jen projekci.
-- kiosk_rozsah má updated_at, ale trigger chyběl (brána production-build, 2026-09-29).
\ir sql/triggers/kiosk_rozsah_updated_at.sql
\ir sql/functions/kiosk_projekce.sql
\ir sql/functions/kiosk_tahac.sql
\ir sql/functions/kiosk_vydej_relaci.sql
\ir sql/functions/get_kiosk_rozvozy.sql
-- ⭐ NÁVRHY VAZEB MEZI DVOJČATY + SCHVALOVÁNÍ PO SKUPINÁCH (2026-09-28).
-- Majitel: „propojit zdroje (měřidla, smlouvy, faktury…) — navrhnout má systém
-- sám a nechat uživateli ke schválení", rozhodovat „po skupinách". Naměřeno
-- v produkci RIQ: twin_relations 0 řádků; li_relation_suggestions 1 735 řádků
-- bez čtenáře a bez stavu rozhodnutí (souběh PARAMETRŮ v dokladu, ne hrana mezi
-- dvojčaty) — návrhy hran neměly kam přistát a nikdo o nich nemohl rozhodnout.
-- Návrh je DŮKAZ, fakt vzniká až rozhodnutím člověka přes twin_relation_open_admin
-- (jediné ruční zápisové místo hran). Pořadí: tabulky → trigger/policy/index →
-- funkce; dispečer (submit_evidence_review_audited, větev 'twin_relation') se
-- přehrává výš ve svém bloku — PL/pgSQL volanou funkci dohledá až za běhu.
\ir sql/tables/twin_relation_proposal_groups.sql
\ir sql/tables/twin_relation_proposals.sql
\ir sql/triggers/twin_relation_proposal_groups_updated_at.sql
\ir sql/triggers/twin_relation_proposals_updated_at.sql
\ir sql/policies/twin_relation_proposal_groups_read.sql
\ir sql/policies/twin_relation_proposals_read.sql
\ir sql/indexes/idx_twin_relation_proposals_group_state.sql
\ir sql/grants/twin_relation_proposal_groups.sql
\ir sql/grants/twin_relation_proposals.sql
\ir sql/functions/twin_relation_propose.sql
\ir sql/functions/twin_relation_proposal_decide.sql
\ir sql/functions/get_twin_relation_proposal_queue.sql
-- Bilance hlavního měřidla proti součtu podružných po obdobích (majitel: chceme
-- vidět, zda součty na podružných měřidlech odpovídají hlavnímu). Podružná jen přes
-- POTVRZENÉ hrany — neschválený návrh do bilance nevstupuje. Slovník (druh hrany,
-- událost spotřeby, cesta k násobiteli) nese konfigurace bloku, ne platforma.
\ir sql/functions/get_meter_balance_block.sql

-- ⭐ HROMADNÉ SCHVÁLENÍ NÁVRHŮ IDENTIT (rozhodnutí majitele 2026-09-28): „teprve dva zdroje
-- pravdy se shodou sto procent opravňují k návrhu na hromadné sloučení"; „pokud jméno nemá
-- IČO, může to být soukromá osoba"; „co se týká IČO, je to v závislosti na časovém údaji";
-- IČO + název + datum z veřejného rejstříku = potvrzení existence. Třídu shody počítá živě
-- twin_ref_tridy (zdroj = třída dokladu z ingestu + výpis z rejstříku, jméno platné k datu
-- dokladu); blok skupin nabízí jen třídy povolené v datech bloku; dávka třídu přepočítá
-- v okamžiku provedení, schvaluje touž ratifikací jako jednotlivě a je vratná přes batch_id.
-- Naměřeno 2026-09-28: z 879 návrhů IČO 857 jen jeden zdroj (účetnictví), 0 shod v čase.
\ir sql/functions/nazev_firmy_klic.sql
\ir sql/functions/twin_ref_tridy.sql
\ir sql/tables/twin_ref_davky.sql
\ir sql/functions/get_twin_ref_group_block.sql
\ir sql/functions/twin_ref_group_decide.sql
\ir sql/functions/twin_ref_davka_vratit.sql
\ir sql/functions/submit_evidence_review_audited.sql

NOTIFY pgrst, 'reload schema';

-- ⛔ HOLÉ LITERÁLY MIMO ENUM V AUDITU (2026-09-29). Osm funkcí předávalo
-- write_audit_journal hodnotu, kterou enum nezná (p_area := 'knowledge_base',
-- p_action_type := 'sync', …), a dvojice test_question měla argumenty na
-- cizích jménech. Literál v pojmenovaném argumentu se přetypuje až za běhu,
-- takže funkce vznikly bez chyby a padaly při KAŽDÉM volání (22P02 / 42883),
-- celá operace se vrátila. Brána enum-consistency je teď vidí. Bez \ir by oprava
-- dotekla jen do čerstvé baseline, ne na běžící DB.
\ir sql/functions/create_knowledge_topic.sql
\ir sql/functions/update_knowledge_topic.sql
\ir sql/functions/delete_knowledge_topic.sql
\ir sql/functions/create_knowledge_post_audited.sql
\ir sql/functions/create_test_question_admin.sql
\ir sql/functions/update_test_question_admin.sql
\ir sql/functions/request_data_sharing_consent.sql
\ir sql/functions/sync_health_data_with_conflict_resolution.sql
-- ⭐ RAG VEKTORY — PLATFORMNÍ DOPOČET (2026-09-29, rozhodnutí majitele: přepočítat
-- staré vektory „samo na serveru"). Chunky bez vektoru ŽIVÉ identity (model z resolveru
-- v1 + deklarovaný pin vah `gguf:<sha>`) dopočítá POST /embeddings/v1-backfill týmž
-- svc-model, kterým se kódují dotazy; text nad declared.max_tokens se nekóduje (tichý
-- ořez llama.cpp) a zapíše se do knowledge_embedding_vynechani. upsert_discovered_model
-- nově zachovává provider_metadata.declared (pin by jinak smazal první discovery sken);
-- dřívější \ir ji přehrává s aktuálním souborem. Tabulka MUSÍ být před funkcemi.
\ir sql/tables/knowledge_embedding_vynechani.sql
\ir sql/policies/knowledge_embedding_vynechani_service_all.sql
\ir sql/functions/fn_chunks_bez_zive_identity.sql
\ir sql/functions/fn_get_chunks_needing_v1.sql
\ir sql/functions/fn_record_embedding_vynechani.sql
-- ⭐ POLOŽKY DOKLADU (2026-09-29, majitel: „u faktury detail POLOŽEK, ne co je ke schválení").
-- Čtečka vydá line_items dokladu jako tabulku s třídou z katalogu bloku knihy faktur.
\ir sql/functions/get_document_lines.sql

NOTIFY pgrst, 'reload schema';

-- ⛔ BĚŽNÝ UŽIVATEL PLATIL ZA ČTENÍ SEKUNDY A PLANNER DOSTÁVAL LŽIVÉ ODHADY (2026-09-29,
-- naměřeno na produkci pod reálnými identitami, každá změna A/B v rollback transakci
-- se shodou md5 výstupu):
--   · li_doc_slugs_claimed_by (volá ji politika li_source_registry_read): role po
--     krocích + drahý predikát PŘED předfiltrem → člen 5,4 s na KAŽDÉ čtení registru
--     (count(*) 5 242 → 157 ms, funkce 5 973 → 4,5 ms).
--   · workflow_step_visible_to: COST 100 → 100000 (naměřeno ~0,56 ms/volání); planner
--     podle COST řadí podmínky.
--   · get_workflow_timeline_block: nárok po řádcích přes všechny kroky, člen 92–95 s
--     přímo přes /rpc = DoS páka → množiny jednou + nekorelovaný IN (admin 1,7 s → 49 ms).
--   · get_timing_tower_block: `OR EXISTS` → planner ocenil po řádcích (7,4 mil.) → JIT
--     1,3–1,5 s; IN → 0,2 s; řazení doplněno o rozhodčí b.id (shody z importu).
--   · get_workflow_my_steps_block: materializované `cfg` skrylo konfiguraci → odhad
--     9,1 mil. → JIT ~4,8 s; not materialized → 108 tis., 5,0 → 0,3 s.
--   · get_surface_scope_axes: volby os i pro sekci bez osy (~0,9 s) → materialized, 1 ms.
-- Predikát MUSÍ předcházet funkcím, které ho volají.
\ir sql/functions/workflow_step_visible_to.sql
\ir sql/functions/li_doc_slugs_claimed_by.sql
\ir sql/functions/get_workflow_timeline_block.sql
\ir sql/functions/get_timing_tower_block.sql
\ir sql/functions/get_workflow_my_steps_block.sql
\ir sql/functions/get_surface_scope_axes.sql

NOTIFY pgrst, 'reload schema';

-- ⛔ COST PREDIKÁTU ZPĚT NA VÝCHOZÍ (2026-09-30, revize kola 13). `COST 100000` z bloku
-- výš zlepšil pořadí v li_doc_slugs_claimed_by, ale planner účtuje cenu restrikční
-- podmínky za KAŽDÝ proskenovaný řádek: sken kroků +123 237 × 250 ≈ 30,8 mil. →
-- get_kiosk_rozvozy (tablet) by kompiloval plný JIT při každém volání. Pořadí v
-- li_doc_slugs drží MATERIALIZED plot, ne COST. CREATE OR REPLACE bez klauzule COST
-- vrací výchozí 100 (ověřuje runtime test predikat-naroku-vychozi-cost).
\ir sql/functions/workflow_step_visible_to.sql

NOTIFY pgrst, 'reload schema';

-- ── 2026-09-30 · TABLET: ROZSAH = NAŠE FLOTILA SPÁROVANÁ S WEBDISPEČINKEM + NEDORUČENÉ ──
-- Majitel (přes RIQi): „podle SPZ a podle řidiče, z našich řidičů — co máme spárované
-- s Webdispečinkem. To, že je to naše doprava, má pomáhat ingestu, ale nemá si to sám
-- řešit tablet.“ A: „minimálně dodáky, o kterých víme, že jsou nedodané, podle řidičů
-- a podle aut.“
-- NAMĚŘENO 30. 9. (RIQi, read-only): rozsah podle `carrier_name` (kiosk_rozsah, idata 68)
-- se nepotkal s ANI JEDNÍM ze 41 037 kroků předání (klíč v krocích chybí) → tablet prázdný
-- i přes den; get_kiosk_rozvozy navíc bral jen production_date = dnes, takže včerejších
-- 12 nedoručených by neukázal ani se správným rozsahem.
--   · kiosk_rozsah: + okno_zpet / okno_dopredu / zdroj_stav / jen_flotila (DATA instance;
--     výchozí 0/0/{}/false = chování F2). ALTER … ADD COLUMN IF NOT EXISTS pro DB z kola 12.
--     Přechod dopravci → flotila řídí DATA (revize RIQi): řádek s jen_flotila pouští jen
--     naši flotilu, řádky dopravců platí dál, dokud je krok dat instance nevypne.
--   · kiosk_krok_nasi_flotily: „čí“ rozhoduje JEN potvrzené a platné párování řidiče
--     (dvojče driver) nebo vozidla (SPZ z Webdispečinku → dvojče vehicle) — pravidla RIQi:
--     shoda jména je jen návrh, druh entity je součást klíče.
--   · workflow_step_visible_to (větev zařízení): řádek pokrývá krok (a u jen_flotila je krok naší flotily).
--   · get_kiosk_rozvozy: okno nedoručených z rozsahu + dnes dokončené, bez dokladů, které
--     zdroj hlásí jako vyřízené (týž mechanismus jako páska řidiče).
-- Pořadí: tabulka → pomocník → predikát (volá pomocníka) → výpis (volá predikát).
\ir sql/tables/kiosk_rozsah.sql
\ir sql/functions/kiosk_krok_nasi_flotily.sql
\ir sql/functions/workflow_step_visible_to.sql
\ir sql/functions/get_kiosk_rozvozy.sql

NOTIFY pgrst, 'reload schema';

-- ⛔ NEŠIFROVANÁ TAJEMSTVÍ V app_secrets (2026-09-28, změřeno na riq): tabulka měla
-- SELECT pro anon a ALL pro authenticated; chránila ji jen RLS politika „admin" —
-- admin (i útok přes jeho relaci) četl hodnoty přes /rest/v1/app_secrets.
-- set_api_key_admin do ní psal nešifrovanou kopii a get_app_secret/_batch ji četly.
-- Pořadí je význam: granty pryč → převod do trezoru (idempotentní, nic nemaže)
-- → teprve pak čtenáři přepnutí na trezor, ať nenajdou prázdno. Vše PO funkcích
-- trezoru výš (vault_create_secret, vault_decrypted_secrets).
\ir sql/grants/app_secrets.sql
\ir sql/functions/migrate_app_secrets_to_vault.sql
SELECT public.migrate_app_secrets_to_vault() AS app_secrets_prevedeno_do_trezoru;
\ir sql/functions/get_app_secret.sql
\ir sql/functions/get_app_secrets_batch.sql
\ir sql/functions/get_github_app_secrets_from_vault.sql
\ir sql/functions/set_api_key_admin.sql
-- 2026-09-29 zpevnění (b): stav klíčů ve správě = přítomnost (bez dešifrování, bez
-- zlomků hodnoty) a edge_app_secrets — oba dřív jen v baseline, změna by na běžící
-- DB nedorazila.
\ir sql/functions/get_api_keys_status_admin.sql
\ir sql/functions/edge_app_secrets.sql
-- ⭐ SCHVÁLENÍ SE PŘENÁŠÍ NA NOVÝ KÓD (2026-09-27, rozhodnutí majitele). Naměřeno
-- na instanci: každé kolo s novou verzí pluginu vrátilo T-CARS / Webdispečink /
-- AVP na `submitted` a data přestala téct, dokud někdo neklikl „Schválit do
-- provozu". `submit_plugin` teď schválení (canary/ga) PŘENESE, když internal
-- plugin podává správa (plugin-publish-init) a nová verze nerozšiřuje oprávnění
-- (capabilities, rpc/network allowlist ⊆, strop zdrojů ≤, zdroj zápisu a druh
-- beze změny); jinak reset s důvodem v auditu. Servisní role dál jen navrhuje.
\ir sql/functions/submit_plugin.sql
-- ── 2026-09-30 · POLOŽKY DOKLADU KROKU PRO ŘIDIČE I TABLET ──
-- Majitel: „v mobilní aplikaci řidiče nevidím detail dodávky/dokladu — co, kolik a čeho
-- odvézt“. NAMĚŘENO (RIQi, read-only jako schválené zařízení): položky na dokladu jsou
-- (17/17 předání v okně tabletu; klíče item_code / item_name / quantity / unit), ale
-- detail kroku tabletu nevydá doc_slug a registr účtu zařízení žádný doklad neukáže.
--   · kiosk_rozsah + pole_polozek (DATA instance, výchozí {} = tablet položky nedostane).
--   · get_workflow_step_polozky: položky s KROKEM (nárok = predikát kroku, tablet jen
--     deklarované klíče), platná verze dokladu po řetězu superseded_by; registr ani
--     doc_slug volající nedostane. RLS registru se NEROZŠIŘUJE.
-- Pořadí: tabulka → funkce (čte kiosk_rozsah, predikát i pomocníka flotily).
\ir sql/tables/kiosk_rozsah.sql
\ir sql/functions/get_workflow_step_polozky.sql
-- ── Stráž story u pěti story-scoped RPC (2026-09-14) ─────────────────────────
-- Naměřeno: transition_story_delivery_status, get_allowed_transitions,
-- moderate_development_flow, mcp_get_compliance_context a
-- generate_copilot_instructions jsou SECURITY DEFINER s GRANT authenticated a
-- nekontrolovaly, zda volající na story smí — přihlášený cizí uživatel četl
-- kontext/ruleset cizí story a měnil její delivery_status. Žádná z pěti funkcí
-- NEBYLA v heals → i dřívější úpravy jejich SoT doběhly jen na cold start.
-- Jeden predikát can_access_story (service_role, admin/staff, vlastník,
-- účastník; zápis bez role 'viewer'); stráž stojí PŘED dohledáním story, takže
-- cizí a neexistující story vrací totéž 42501. Pořadí: predikát před funkcemi.
\ir sql/functions/can_access_story.sql
\ir sql/functions/transition_story_delivery_status.sql
\ir sql/functions/get_allowed_transitions.sql
\ir sql/functions/moderate_development_flow.sql
\ir sql/functions/mcp_get_compliance_context.sql
\ir sql/functions/generate_copilot_instructions.sql
-- ── Hlas a Matrix: kdo smí do místnosti a k mapování story (2026-10-01) ──────
-- Naměřeno (audit hlasu 2026-09-29 H-5, audit vydání 2026-10-01 B2): šest RPC nad
-- voice_rooms / story_matrix_rooms bylo SECURITY DEFINER s GRANT authenticated a
-- ptalo se jen na přihlášení — cizí přihlášený četl PTT místnost a Matrix místnost
-- cizí story, seznam účastníků cizí konzultace, zapsal se do cizího PTT kanálu a
-- připojil svou Matrix místnost k cizí story. svc-livekit vydával token do
-- konzultace komukoli se jménem místnosti. ŽÁDNÁ z funkcí NEBYLA v heals → ani
-- oprava get_story_matrix_rooms ze 17. 7. nedoběhla na běžící DB.
-- Story: can_access_story (výš). Místnost: can_enter_voice_room — konzultace jen
-- volající/volaný, story místnost vlastník/účastník, správa BEZ obchvatu do hovoru.
-- Podpisy beze změny od založení (ověřeno git log) → CREATE OR REPLACE projde
-- i na DB z nejstarší baseline. Pořadí: predikát → čtečka → funkce, které ho volají.
\ir sql/functions/can_enter_voice_room.sql
\ir sql/functions/get_voice_room_entry.sql
\ir sql/functions/create_story_matrix_room.sql
\ir sql/functions/get_story_general_matrix_room.sql
\ir sql/functions/get_story_matrix_rooms.sql
\ir sql/functions/get_story_ptt_room.sql
\ir sql/functions/join_ptt_channel.sql
\ir sql/functions/get_room_participants.sql
\ir sql/functions/create_consultation_call.sql
\ir sql/functions/upsert_call_participant.sql

-- ── moderate_development_flow: skutečné kategorie + compliance ze story rulesetu (2026-09-14) ──
-- Naměřeno na throwaway DB: filtr porovnával enum expert_rule_category s literály,
-- které v enumu nejsou ('testing', 'quality', 'compliance', 'security', …) → 22P02
-- KAŽDÉMU volajícímu, jakmile existovalo pravidlo (seed jich zakládá 22). Nástroje
-- moderate_flow / suggest_next_step / check_pr_compliance tak nefungovaly nikde.
-- Pod tím byla druhá vada: ORDER BY/LIMIT na agregačním dotazu. Mapování rozhodnuto:
-- compliance = pravidla připnutá ke story (severity error u pr_review/pre_commit),
-- quality = coding_standard + performance_optimization. Kategorie jsou typované pole.
\ir sql/functions/moderate_development_flow.sql
-- ── Sekvence delivery_transition_rules za daty ze seedu (2026-09-14) ─────────
-- Naměřeno: seed vkládá pravidla přechodů s pevnými id (až 729) a sekvenci
-- neposouval → na KAŽDÉ instanci nasazené z něj vrací nextval() id, které už
-- existuje, a první INSERT bez id padá na pkey. Oprava v seedu pomůže jen novým
-- instancím; tenhle příkaz dorovná běžící. Jen dopředu, idempotentní.
-- >>> sekvence-za-daty
SELECT setval(
  'public.delivery_transition_rules_id_seq'::regclass,
  GREATEST(
    (SELECT COALESCE(max(id), 0) FROM public.delivery_transition_rules),
    (SELECT COALESCE(last_value, 0) FROM pg_sequences
      WHERE schemaname = 'public' AND sequencename = 'delivery_transition_rules_id_seq'),
    1),
  EXISTS (SELECT 1 FROM public.delivery_transition_rules)
    OR EXISTS (SELECT 1 FROM pg_sequences
      WHERE schemaname = 'public' AND sequencename = 'delivery_transition_rules_id_seq' AND last_value IS NOT NULL)
);
-- <<< sekvence-za-daty

NOTIFY pgrst, 'reload schema';

-- ⭐ DRUH ENTITY V KLÍČI VAZBY IDENTITY (2026-09-27). Vazba byla jedinečná jen
-- v (source, source_key, ref_kind): zdroj, který čísluje dva druhy objektů
-- zvlášť (vozidlo 5 × osoba 5), pod holým číslem kolidoval — potvrzené vozidlo
-- „zabralo" klíč osoby, resolve vrátil za řidiče vozidlo a
-- twin_upsert_entity_audited by osobě přepsal vozidlo. Teď je druh entity
-- (odvozený z dvojčete, ne od volajícího) součástí klíče jedinečnosti.
--
-- Pořadí je NOSNÉ: sloupec + doplnění (tabulka) → trigger funkce → trigger
-- vazeb, opakované doplnění, kontrola a NOT NULL → trigger šíření druhu
-- z twin_entities → index (výměna bez okna bez pojistky: starý přejmenovat,
-- nový vytvořit, starý zahodit) → stará signatura resolve pryč (jinak by
-- volání se čtyřmi argumenty bylo nejednoznačné) → funkce, které vlastníka
-- klíče hledají.
\ir sql/tables/twin_external_refs.sql
\ir sql/functions/twin_external_refs_set_entity_type.sql
\ir sql/functions/twin_entities_propagate_entity_type.sql
\ir sql/triggers/twin_external_refs_entity_type.sql
\ir sql/triggers/twin_entities_entity_type_refs.sql
\ir sql/indexes/uq_twin_external_refs_active_owner.sql
DROP FUNCTION IF EXISTS public.twin_identity_resolve(text, text, text, timestamptz);
\ir sql/functions/twin_identity_resolve.sql
\ir sql/functions/twin_identity_propose_binding.sql
\ir sql/functions/twin_identity_confirm_binding.sql
\ir sql/functions/twin_upsert_entity_audited.sql
\ir sql/functions/twin_identity_list_unmatched.sql
\ir sql/functions/revert_twin_decision_admin.sql
\ir sql/functions/wd_twin_fleet_current.sql

NOTIFY pgrst, 'reload schema';

-- ⭐ EXECUTOR AKCÍ PO UDÁLOSTI (F3a, 2026-09-28). Pravidla ai_proactive_trigger_definitions
-- dispečer zapisoval do outboxu ai_proactive_runs a budil pg_notify('ai_proactive_dispatch') —
-- ale NIKDO neposlouchal (naměřeno 26. 9.: svc-ai-chat je čistě event-driven, pg_net v obrazu
-- DB není, most do n8n tedy nikdy nic nedoručil). Běhy ležely `pending` napořád. Executor
-- v event-workeru je teď zabírá (notify i dohnání z outboxu), vrací zaseknuté a vykonává
-- CRON pravidla; tady je jeho DB polovina. Dispečer přišel o mrtvý net.http_post a notify
-- nese jen identifikátory (strop 8000 B dřív vracel i zápis běhu).
\ir sql/functions/claim_proactive_run.sql
\ir sql/functions/claim_pending_proactive_runs.sql
\ir sql/functions/requeue_stale_proactive_runs.sql
\ir sql/functions/finish_proactive_run.sql
\ir sql/functions/record_cron_proactive_run.sql
\ir sql/functions/list_cron_proactive_definitions.sql
-- (fn_dispatch_proactive_triggers.sql se přehrává ve svém původním bloku výš — změna těla dojde tam.)
\ir sql/indexes/idx_ai_proactive_runs_otevrene.sql
\ir sql/indexes/uq_ai_proactive_runs_cron_slot.sql
-- Principál pravidla pro kanál executoru (SoT: tables/ai_proactive_trigger_definitions.sql).
-- Na běžící DB se přidá NOT VALID a hned validuje: existující pravidlo bez principála
-- (dnes žádné — kanály executoru do F3a neexistovaly) nezastaví migrate, jen se ohlásí;
-- nové už zapsat nepůjde.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_proactive_defs_executor_principal_check') THEN
    ALTER TABLE public.ai_proactive_trigger_definitions
      ADD CONSTRAINT ai_proactive_defs_executor_principal_check CHECK (
        NOT ((action_config ->> 'channel') = ANY (ARRAY['extranet', 'push', 'email']))
        OR created_by IS NOT NULL
      ) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE public.ai_proactive_trigger_definitions
      VALIDATE CONSTRAINT ai_proactive_defs_executor_principal_check;
  EXCEPTION WHEN check_violation THEN
    RAISE WARNING 'ai_proactive_defs_executor_principal_check: existují pravidla kanálů executoru bez created_by — dispečer je přeskakuje; doplň principála';
  END;
END $$;

NOTIFY pgrst, 'reload schema';
