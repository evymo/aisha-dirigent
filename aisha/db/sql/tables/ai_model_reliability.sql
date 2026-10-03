-- Table: ai_model_reliability  (L1 — reactive telemetry sink, SEPARATE from ai_model_benchmarks)
--
-- WHY A SEPARATE TABLE (binding correction): ai_model_benchmarks holds CURATED QUALITY (one current
-- row per model+task, written by the eval runner) and the resolver LEFT JOINs it with NO dedup
-- (aisha_resolve_clow_backend: b.task_type = v_task_kind) — so ANY extra row there fans out the
-- candidate set and leaks into the quality ranking (see the warning in record_model_benchmark.sql).
-- Reactive production telemetry therefore must NOT land in ai_model_benchmarks. It lands here, where
-- nothing in the resolver reads it today → zero ranking impact, fully ADVISORY. L2 (advisory
-- proposals) and any future, deliberately-reviewed resolver tie-breaker can consume it explicitly.
--
-- Grain: exactly one CURRENT row per (model_registry_id, task_kind) — UNIQUE + upsert (REPLACE),
-- so a rolling window never accumulates stale rows. task_kind is normalized (normalize_task_kind).

CREATE TABLE IF NOT EXISTS public.ai_model_reliability (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_registry_id  uuid        NOT NULL REFERENCES public.ai_model_registry(id) ON DELETE CASCADE,
  task_kind          text        NOT NULL,                 -- normalized (normalize_task_kind)
  sample_count       bigint      NOT NULL DEFAULT 0,
  success_rate       numeric,                              -- reliability (from trace status)
  error_rate         numeric,
  avg_latency_ms     integer,
  p95_latency_ms     integer,
  avg_cost_per_call  numeric,
  avg_eval_score     numeric,                              -- real eval (faithfulness) avg; NULL when none — ADVISORY, not a ranking input
  window_hours       integer,                              -- the rollup window that produced this row
  measured_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_registry_id, task_kind)
);

ALTER TABLE public.ai_model_reliability ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_model_reliability IS
  'L1 reactive telemetry sink (reliability/latency/cost per model x normalized task_kind), one current row per pair. SEPARATE from ai_model_benchmarks so production telemetry never enters the resolver quality ranking (advisory-only). Written by record_model_reliability via fn_rollup_outcomes_to_benchmark.';
