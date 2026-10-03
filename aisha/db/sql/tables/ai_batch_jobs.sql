-- Table: ai_batch_jobs
-- Tracks deferred LLM batch jobs submitted to Anthropic Message Batches
-- (https://docs.anthropic.com/en/docs/build-with-claude/batch-processing) or
-- OpenAI Batch API (https://platform.openai.com/docs/guides/batch). 50% off
-- on sync pricing for non-urgent workloads. AISHA dynamically decides sync vs
-- batch via aisha_choose_execution_strategy.
--
-- Lifecycle: submitted → in_progress → completed | expired | failed.
-- Polled every ~15min by WF_BATCH_POLLER (n8n); polling updates status +
-- writes results into ai_runs.

CREATE TABLE IF NOT EXISTS public.ai_batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provider identification
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  external_batch_id text NOT NULL,

  -- Lifecycle
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_progress', 'completed', 'expired', 'failed', 'cancelled')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_polled_at timestamptz,

  -- Volume + cost
  request_count int NOT NULL DEFAULT 1,
  succeeded_count int NOT NULL DEFAULT 0,
  errored_count int NOT NULL DEFAULT 0,
  estimated_cost numeric(10,4),
  actual_cost numeric(10,4),

  -- Result pointer (provider-hosted JSONL)
  result_url text,

  -- Bind to AISHA semantic context. Either a single related run, or a batch
  -- spanning multiple runs / agent tasks.
  related_run_id uuid REFERENCES public.ai_runs(id),
  agent_slug text DEFAULT 'aisha',
  story_id uuid REFERENCES public.partner_stories ON DELETE SET NULL,

  -- Extensible metadata: { task, slot, profile, model, deadline_hours }
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Audit
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A single external_batch_id from a given provider must be unique
  CONSTRAINT ai_batch_jobs_provider_external_unique
    UNIQUE (provider, external_batch_id)
);

ALTER TABLE public.ai_batch_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_batch_jobs IS
  'Deferred LLM batch jobs (Anthropic Message Batches / OpenAI Batch API). '
  'AISHA dynamically decides sync vs batch via aisha_choose_execution_strategy. '
  'WF_BATCH_POLLER polls pending rows every ~15min and writes results into ai_runs.';

-- Indexes live in aisha/db/sql/indexes/idx_ai_batch_jobs.sql per SQL
-- Source Separation rule (sql-source-separation.test.ts).
