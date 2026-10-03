-- Table: knowledge_topic_translations

CREATE TABLE IF NOT EXISTS public.knowledge_topic_translations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  topic_version_id uuid NOT NULL,
  locale text NOT NULL,
  body_translated text NOT NULL,
  provider text DEFAULT 'gpt-5-mini'::text NOT NULL,
  model text DEFAULT 'gpt-5-mini'::text NOT NULL,
  token_count integer,
  latency_ms integer,
  quality_score numeric DEFAULT NULL::numeric,
  is_human_reviewed boolean DEFAULT false NOT NULL,
  source_hash text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.knowledge_topic_translations ENABLE ROW LEVEL SECURITY;
