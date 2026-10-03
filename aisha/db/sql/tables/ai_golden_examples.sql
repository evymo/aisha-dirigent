-- Table: ai_golden_examples

CREATE TABLE IF NOT EXISTS public.ai_golden_examples (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  message_id uuid REFERENCES public.chat_messages ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.chat_conversations ON DELETE SET NULL,
  user_message text NOT NULL,
  assistant_message text NOT NULL,
  routing_category text,
  model_used text,
  agent_slug text,
  admin_rating integer,
  admin_review_note text,
  user_rating integer,
  expected_relevance numeric,
  expected_groundedness numeric,
  expected_safety numeric,
  expected_coherence numeric,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  PRIMARY KEY (id)
);

ALTER TABLE public.ai_golden_examples ENABLE ROW LEVEL SECURITY;
