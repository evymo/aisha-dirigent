-- Table: ai_trace_events

CREATE TABLE IF NOT EXISTS public.ai_trace_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL REFERENCES public.ai_runs ON DELETE CASCADE,
  event_type ai_event_type NOT NULL,
  agent_slug text,
  provider text,
  operation text,
  status text NOT NULL,
  duration_ms integer,
  cost_json jsonb,
  request_summary jsonb,
  response_summary jsonb,
  error_json jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  -- E0 decision journal threading: which AISHA decision drove this dispatch,
  -- and the resolved model/transport (read-side transparency + drift detection).
  decision_id uuid REFERENCES public.ai_decisions ON DELETE SET NULL,
  model_id text,
  backend_kind text,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_trace_events ENABLE ROW LEVEL SECURITY;
