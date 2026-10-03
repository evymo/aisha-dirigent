-- Table: rag_eval_golden

CREATE TABLE IF NOT EXISTS public.rag_eval_golden (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL,
  question text NOT NULL,
  ground_truth_answer text NOT NULL,
  expected_chunk_slugs text[] DEFAULT '{}'::text[],
  context_profile_slug text,
  expertise_area_slug text,
  story_id uuid,
  difficulty smallint,
  language text DEFAULT 'en'::text,
  status text DEFAULT 'active'::text,
  tags text[] DEFAULT '{}'::text[],
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT rag_eval_golden_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 5))),
  CONSTRAINT rag_eval_golden_language_check CHECK ((language = ANY (ARRAY['cs'::text, 'en'::text]))),
  CONSTRAINT rag_eval_golden_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text, 'draft'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT rag_eval_golden_slug_key UNIQUE (slug),
  CONSTRAINT rag_eval_golden_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  CONSTRAINT rag_eval_golden_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.partner_stories(id) ON DELETE CASCADE
);

ALTER TABLE public.rag_eval_golden ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.rag_eval_golden IS 'Curated golden Q/A pairs used by the nightly RAG eval pipeline. Each row is the spec for one retrieval quality assertion.';
COMMENT ON COLUMN public.rag_eval_golden.expected_chunk_slugs IS 'Optional set of knowledge chunk slugs/labels expected to be retrieved. Used to compute context_recall.';
COMMENT ON COLUMN public.rag_eval_golden.difficulty IS '1=trivial recall, 5=multi-hop reasoning over multiple sources.';
