-- Table: agent_runs

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL,
  profile text NOT NULL,
  image text NOT NULL,
  requested_by uuid,  -- NULLABLE: a system-spawned run (svc-agent-runner / reflection cli adapter calls fn_spawn under service_role, auth.uid()=NULL) has no human requester. Mirrors playwright_runs.requested_by.
  source text NOT NULL,
  source_ref text,
  inputs_s3_uri text,
  inputs jsonb,
  outputs_s3_uri text,
  outputs jsonb,
  status text DEFAULT 'queued'::text NOT NULL,
  exit_code integer,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  host text,
  langfuse_trace_id text,
  error_summary text,
  -- Admission / approval (E0). A claude_cli_task whose fn_admit_clow verdict is
  -- 'ask' is created with approval_required=true + approved_at=NULL and is HELD —
  -- claim_queued_claude_run skips it — until approve_claude_run sets approved_at.
  -- Mirrors the playwright_runs approval gate (approval_required + approved_at).
  approval_required boolean DEFAULT false NOT NULL,
  approved_at timestamp with time zone,
  approved_by uuid,
  awaiting text,
  decision_id uuid REFERENCES public.ai_decisions ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT agent_runs_kind_check CHECK ((kind = ANY (ARRAY['plugin-exec'::text, 'workflow-exec'::text, 'repo-agent'::text, 'doc-agent'::text, 'claude_cli_task'::text]))),
  CONSTRAINT agent_runs_profile_check CHECK ((profile = ANY (ARRAY['docker'::text, 'kata-firecracker'::text, 'kata-dragonball'::text]))),
  CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'timeout'::text, 'cancelled'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT agent_runs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Heal: `inputs` was added by fe939cf1 (agent-activity). CREATE TABLE IF NOT
-- EXISTS above does not add it to a pre-existing agent_runs, so seed/runtime
-- INSERTs referencing inputs fail on upgraded DBs. Idempotent ADD COLUMN IF NOT
-- EXISTS heals them (nullable → safe on existing rows; no-op on fresh DBs).
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS inputs jsonb;

-- Heal: `outputs` is the executor's STRUCTURED result (the validated `__result`
-- sentinel + a log tail) — symmetric with `inputs`. Same idempotent ADD COLUMN
-- IF NOT EXISTS pattern so upgraded DBs gain it (nullable → safe; no-op on fresh).
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS outputs jsonb;

-- Heal: admission/approval columns (E0 — an fn_admit_clow 'ask' verdict holds a run
-- pending human approval). Idempotent ADD COLUMN IF NOT EXISTS so upgraded DBs gain
-- them (defaulted/nullable → safe on existing rows; no-op on fresh).
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS approval_required boolean DEFAULT false NOT NULL;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS awaiting text;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS decision_id uuid;

COMMENT ON TABLE public.agent_runs IS 'Execution plane records — each isolated workload run (plugin, workflow, agent) tracked here.';
COMMENT ON COLUMN public.agent_runs.approval_required IS 'True when fn_admit_clow returned ask for this run — held (claim skips it) until approve_claude_run sets approved_at. Mirrors playwright_runs.';
COMMENT ON COLUMN public.agent_runs.awaiting IS 'The admission axis awaiting approval (e.g. risk_approval) when approval_required — surfaced to Mission Control via list_pending_claude_approvals.';
COMMENT ON COLUMN public.agent_runs.decision_id IS 'The ai_decisions row (I1 journal) minted for this dispatch by fn_record_execution_decision — links the run to its admission verdict.';
COMMENT ON COLUMN public.agent_runs.inputs IS 'Structured run inputs (jsonb). For kind=claude_cli_task: {story_id, prompt, base_ref, branch, auth_mode, context_profile}. Large/external inputs use inputs_s3_uri instead.';
COMMENT ON COLUMN public.agent_runs.outputs IS 'Structured run result (jsonb). For kind=claude_cli_task: {ok, run_id, exit_code} from the schema-validated `__result` sentinel + a trailing log slice. NULL until the run finalizes. Large/external outputs use outputs_s3_uri instead.';
