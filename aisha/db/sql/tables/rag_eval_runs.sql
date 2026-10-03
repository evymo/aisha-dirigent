-- Table: rag_eval_runs

CREATE TABLE IF NOT EXISTS public.rag_eval_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  golden_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  embedding_model text NOT NULL,
  embedding_model_version text,
  llm_model text NOT NULL,
  judge_model text,
  context_profile_slug text,
  retrieved_chunk_ids uuid[] DEFAULT '{}'::uuid[],
  retrieved_chunk_count integer GENERATED ALWAYS AS (COALESCE(array_length(retrieved_chunk_ids, 1), 0)) STORED,
  generated_answer text,
  faithfulness_score numeric(4,3),
  answer_relevancy_score numeric(4,3),
  context_precision_score numeric(4,3),
  context_recall_score numeric(4,3),
  composite_score numeric(4,3) GENERATED ALWAYS AS (
CASE
    WHEN ((faithfulness_score IS NULL) OR (answer_relevancy_score IS NULL) OR (context_precision_score IS NULL) OR (context_recall_score IS NULL)) THEN NULL::numeric
    ELSE round(((((faithfulness_score * 0.4) + (answer_relevancy_score * 0.2)) + (context_precision_score * 0.2)) + (context_recall_score * 0.2)), 3)
END) STORED,
  latency_ms integer,
  cost numeric(10,6),
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  ai_run_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT rag_eval_runs_answer_relevancy_score_check CHECK (((answer_relevancy_score IS NULL) OR ((answer_relevancy_score >= (0)::numeric) AND (answer_relevancy_score <= (1)::numeric)))),
  CONSTRAINT rag_eval_runs_context_precision_score_check CHECK (((context_precision_score IS NULL) OR ((context_precision_score >= (0)::numeric) AND (context_precision_score <= (1)::numeric)))),
  CONSTRAINT rag_eval_runs_context_recall_score_check CHECK (((context_recall_score IS NULL) OR ((context_recall_score >= (0)::numeric) AND (context_recall_score <= (1)::numeric)))),
  CONSTRAINT rag_eval_runs_faithfulness_score_check CHECK (((faithfulness_score IS NULL) OR ((faithfulness_score >= (0)::numeric) AND (faithfulness_score <= (1)::numeric)))),
  PRIMARY KEY (id),
  CONSTRAINT rag_eval_runs_ai_run_id_fkey FOREIGN KEY (ai_run_id) REFERENCES public.ai_runs(id) ON DELETE SET NULL,
  CONSTRAINT rag_eval_runs_golden_id_fkey FOREIGN KEY (golden_id) REFERENCES public.rag_eval_golden(id) ON DELETE CASCADE
);

ALTER TABLE public.rag_eval_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.rag_eval_runs IS 'Per-run RAG eval scoring rows. Composite score = 0.4*faithfulness + 0.2*(relevancy+precision+recall). Faithfulness is primary north-star.';
