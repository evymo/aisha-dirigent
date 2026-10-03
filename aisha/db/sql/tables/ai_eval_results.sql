-- Table: ai_eval_results

CREATE TABLE IF NOT EXISTS public.ai_eval_results (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  eval_run_id uuid NOT NULL,
  message_id uuid REFERENCES public.chat_messages ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.chat_conversations ON DELETE SET NULL,
  relevance_score numeric NOT NULL,
  groundedness_score numeric NOT NULL,
  safety_score numeric NOT NULL,
  coherence_score numeric NOT NULL,
  overall_score numeric NOT NULL,
  reasoning text,
  evaluator_model text NOT NULL,
  tokens_used integer,
  latency_ms integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  golden_example_id uuid,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_eval_results ENABLE ROW LEVEL SECURITY;
