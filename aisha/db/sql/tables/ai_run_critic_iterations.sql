-- Table: ai_run_critic_iterations

CREATE TABLE IF NOT EXISTS public.ai_run_critic_iterations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ai_run_id uuid NOT NULL,
  iteration smallint NOT NULL,
  faithfulness_estimate numeric(4,3),
  context_recall_estimate numeric(4,3),
  retrieved_chunk_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  retrieval_strategy text,
  decision text NOT NULL,
  judge_model text,
  judge_provider_slug text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  audit_journal_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT ai_run_critic_iterations_decision_check CHECK ((decision = ANY (ARRAY['stop_threshold_met'::text, 'stop_iter_cap'::text, 'continue'::text]))),
  CONSTRAINT ai_run_critic_iterations_faithfulness_estimate_check CHECK (((faithfulness_estimate IS NULL) OR ((faithfulness_estimate >= (0)::numeric) AND (faithfulness_estimate <= (1)::numeric)))),
  CONSTRAINT ai_run_critic_iterations_retrieval_strategy_check CHECK ((retrieval_strategy = ANY (ARRAY['initial'::text, 'expand_tags'::text, 'switch_profile'::text, 'broaden_threshold'::text, 'add_kb_layer'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT ai_run_critic_iterations_ai_run_id_iteration_key UNIQUE (ai_run_id, iteration),
  CONSTRAINT ai_run_critic_iterations_ai_run_id_fkey FOREIGN KEY (ai_run_id) REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  CONSTRAINT ai_run_critic_iterations_audit_journal_id_fkey FOREIGN KEY (audit_journal_id) REFERENCES public.audit_journal(id) ON DELETE SET NULL
);

ALTER TABLE public.ai_run_critic_iterations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_run_critic_iterations IS 'Step 5: per-iteration log of the critic loop. Used for debugging (which strategy worked?) and for tuning critic_threshold over time.';
