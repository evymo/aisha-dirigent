-- Table: workbench_execution_requests
-- PR-J workbench execution rail: svc-ai-chat ENQUEUES work (pending), the aisha-dirigent
-- VSCode extension CLAIMS it (claimed), runs it on a LOCAL model, and posts the result
-- back (completed/failed). A capability-availability WORK SURFACE — not a model catalog
-- (that is ai_model_registry). The central adapter blocks-polls for the result; there is
-- no push to the dev's machine, so the rail works behind NAT/firewall.
--
-- RLS: service_role full access (the adapter enqueues/polls) + admin/staff read; the
-- extension claim/complete go through SECURITY DEFINER RPCs, not direct DML.
-- Triggers -> triggers/, policies -> policies/ (table SoT must not inline either, so the
-- cold-start table-before-function ordering holds). run_id is a plain uuid (no FK) so an
-- orphaned/absent run never blocks an enqueue.
CREATE TABLE IF NOT EXISTS public.workbench_execution_requests (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  -- work payload (mirrors RuntimeWork; the full clow is stored for trace/replay)
  clow            jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_input   text NOT NULL,
  model_id        text,
  provider_slug   text,
  run_id          uuid REFERENCES public.ai_runs ON DELETE SET NULL,
  story_id        uuid REFERENCES public.partner_stories ON DELETE SET NULL,
  decision_id     uuid REFERENCES public.ai_decisions ON DELETE SET NULL,
  -- lifecycle
  status          text NOT NULL DEFAULT 'pending',
  claimed_by      text,
  response        text,
  error_detail    jsonb,
  tokens_in       integer,
  tokens_out      integer,
  latency_ms      integer,
  -- how many times this request has been (re)claimed; claim_pending_workbench_requests
  -- dead-letters it to 'failed' once it exceeds the max, instead of re-running a
  -- request whose claimant keeps dying before completing it. See that function.
  claim_attempts  integer NOT NULL DEFAULT 0,
  -- timestamps
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT workbench_execution_requests_status_check
    CHECK (status IN ('pending', 'claimed', 'completed', 'failed'))
);

ALTER TABLE public.workbench_execution_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.workbench_execution_requests IS
  'PR-J workbench poll+block work queue. svc enqueues (pending) -> extension claims (claimed) -> runs local model -> completes (completed/failed). RLS: service_role writes, admin/staff read.';
