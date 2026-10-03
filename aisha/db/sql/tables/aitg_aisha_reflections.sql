-- ============================================================================
-- Table: aitg_aisha_reflections
-- Purpose: Aisha's daily diary about her own security posture. Each row is
--          one snapshot — trust score now vs previous day, what's open, what
--          changed, what she intends to do about it. This is the durable
--          memory that lets her remember her trajectory across sessions.
--
-- Aisha reads back her own history via aitg_get_reflection_history_audited
-- when she "wakes up" (start of a session / start of a workflow) so she has
-- continuity with her past self.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.aitg_aisha_reflections (
  reflection_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection_date         date NOT NULL,
  trust_score_snapshot    numeric NOT NULL CHECK (trust_score_snapshot BETWEEN 0 AND 100),
  trust_score_delta       numeric,            -- vs previous reflection
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

ALTER TABLE public.aitg_aisha_reflections ENABLE ROW LEVEL SECURITY;
