-- ============================================================================
-- Source of Truth: ai_decisions  (E0 decision journal)
-- Purpose: Persist EVERY AISHA execution decision (one row per dispatch) so the
--          orchestration authority is auditable and queryable. The id IS the
--          decision_id threaded onto ai_trace_events + carried by every runtime
--          adapter. Mirrors the in-memory decisionProvenance chain into durable
--          storage. Written by fn_record_execution_decision (VOLATILE wrapper);
--          the resolver/admission RPCs stay STABLE and never write.
-- Invariant (I1/I3): no dispatch without a journaled decision.
-- Security: RLS — story participants read their story's decisions; admin/staff
--           read all. Writes go through the SECURITY DEFINER wrapper only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_decisions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),   -- decision_id
  run_id        uuid,                                                -- ai_runs.id (nullable: pre-run admission)
  story_id      uuid,                                                -- denormalized for RLS chain
  clow_purpose  text,

  -- runtime axis (executor) — orthogonal to backend_kind (transport)
  runtime       text        NOT NULL DEFAULT 'direct_llm'
                CHECK (runtime IN ('direct_llm', 'openclaw', 'hermes', 'workflow', 'human', 'cli', 'workbench')),
  cli_slug      text,                                                -- when runtime='cli'

  -- model axis (from aisha_resolve_clow_backend.top) — backend_kind tolerant (string)
  provider_slug text,
  model_id      text,
  backend_kind  text,                                               -- transport; NULL for human/hermes
  strategy      text        CHECK (strategy IS NULL OR strategy IN ('sync', 'batch')),

  -- governance axis
  admission_verdict text    CHECK (admission_verdict IS NULL OR admission_verdict IN ('allow', 'ask', 'deny')),
  risk_level    text        CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical')),
  approval_required boolean NOT NULL DEFAULT false,

  -- provenance
  resolution_source text    CHECK (resolution_source IS NULL OR resolution_source IN
                ('clow_backend', 'model_override', 'slot', 'admission_deny', 'policy', 'fallback')),
  reason        text,
  estimated_cost numeric(12,6),
  -- Which operator-tunable ai_resolver_policy row produced this decision (soft ref, no FK: a
  -- historical snapshot — the policy may be retuned later). NULL for non-resolver decisions.
  resolver_policy_id uuid,

  -- Full decision blob for fidelity (the complete AishaExecutionDecision + verdict).
  decision_json jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_decisions IS
  'E0 decision journal: one row per AISHA execution decision. id = decision_id (threaded onto ai_trace_events + every runtime adapter). Written only by fn_record_execution_decision.';

-- Index lives in aisha/db/sql/indexes/idx_ai_decisions_run.sql (SoT separation).

ALTER TABLE public.ai_decisions ENABLE ROW LEVEL SECURITY;
