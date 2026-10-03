-- Table: ai_task_kind_registry  (T1 — OBSERVED, descriptive task_kind registry)
-- NOT authoritative and NOT an enum: this is a descriptive catalogue of the task_kinds that have
-- actually been SEEN (populated by fn_observe_task_kind from real telemetry), so admins/operators
-- can SEE the live vocabulary and (T2) attach per-category policy to it — without ever closing the
-- set. The PK is the already-normalized task_kind (normalize_task_kind). is_curated lets an admin
-- bless a kind (vs a purely observed one); it is a label, not a gate.

CREATE TABLE IF NOT EXISTS public.ai_task_kind_registry (
  task_kind     text PRIMARY KEY,                         -- normalized (normalize_task_kind)
  label         text,                                     -- optional admin-friendly display
  is_curated    boolean      NOT NULL DEFAULT false,      -- admin-blessed vs purely observed
  sample_count  bigint       NOT NULL DEFAULT 0,          -- cumulative observed occurrences
  first_seen_at timestamptz  NOT NULL DEFAULT now(),
  last_seen_at  timestamptz  NOT NULL DEFAULT now(),
  notes         text
);

ALTER TABLE public.ai_task_kind_registry ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_task_kind_registry IS
  'T1: observed/descriptive registry of task_kinds seen in production (PK = normalized task_kind). Auto-grows via fn_observe_task_kind; never an enum/allow-list. Substrate for T2 per-category policy.';
