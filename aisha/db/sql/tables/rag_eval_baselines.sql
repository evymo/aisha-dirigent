-- Table: rag_eval_baselines

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

ALTER TABLE public.rag_eval_baselines ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.rag_eval_baselines IS 'Aggregated baselines for dashboards + regression gates. Recomputed by fn_compute_rag_baseline_audited (called from WF_RAG_EVAL_NIGHTLY).';
