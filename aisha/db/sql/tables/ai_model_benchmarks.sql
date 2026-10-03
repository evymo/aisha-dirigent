-- Table: ai_model_benchmarks

CREATE TABLE IF NOT EXISTS public.ai_model_benchmarks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  model_registry_id uuid NOT NULL REFERENCES public.ai_model_registry(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  relevance_score numeric,
  groundedness_score numeric,
  safety_score numeric,
  coherence_score numeric,
  overall_score numeric,
  avg_latency_ms integer,
  p95_latency_ms integer,
  avg_tokens_input integer,
  avg_tokens_output integer,
  avg_cost_per_call numeric,
  success_rate numeric,
  timeout_rate numeric,
  error_rate numeric,
  eval_run_id uuid,
  sample_count integer DEFAULT 0 NOT NULL,
  measured_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_model_benchmarks ENABLE ROW LEVEL SECURITY;
