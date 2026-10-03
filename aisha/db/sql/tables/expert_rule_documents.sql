-- Table: expert_rule_documents

CREATE TABLE IF NOT EXISTS public.expert_rule_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  rule_id uuid NOT NULL REFERENCES public.expert_rules ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  file_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  content_markdown text,
  document_type text DEFAULT 'example'::text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.expert_rule_documents ENABLE ROW LEVEL SECURITY;
