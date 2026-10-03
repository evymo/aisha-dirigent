-- Table: personality_signals

CREATE TABLE IF NOT EXISTS public.personality_signals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  signal_type text NOT NULL,
  value jsonb DEFAULT '{}'::jsonb NOT NULL,
  weight real DEFAULT 0.5 NOT NULL,
  conversation_id uuid REFERENCES public.chat_conversations ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT personality_signals_weight_check CHECK (((weight >= (0.0)::double precision) AND (weight <= (1.0)::double precision))),
  PRIMARY KEY (id),
  CONSTRAINT personality_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.personality_signals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.personality_signals IS 'Raw interaction signals captured by Hippocampus for personality evolution. Aggregated periodically into experiential traits (agent_memories).';
COMMENT ON COLUMN public.personality_signals.signal_type IS 'Signal category: humor_response, frustration, gratitude, vulgarity, formality_shift, engagement_burst, silence_preference, joy, curiosity';
COMMENT ON COLUMN public.personality_signals.weight IS 'Signal strength 0.0–1.0. Higher = stronger behavioral signal.';
