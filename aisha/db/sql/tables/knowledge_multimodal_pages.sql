-- Table: knowledge_multimodal_pages

CREATE TABLE IF NOT EXISTS public.knowledge_multimodal_pages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  knowledge_item_id uuid NOT NULL,
  page_number integer NOT NULL,
  page_image_uri text,
  page_image_sha256 text,
  page_text text,
  -- halfvec type referenced UNQUALIFIED (matches sibling knowledge_embeddings) — the
  -- pgvector extension is in `extensions` on a fresh baseline, so a public-qualified
  -- type is unresolvable from zero; bare + search_path (public, extensions) resolves it.
  embedding_v2 halfvec(2560),
  embedding_model text,
  embedding_version text,
  embedding_generated_at timestamp with time zone,
  status text DEFAULT 'pending'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_multimodal_pages_page_number_check CHECK ((page_number > 0)),
  CONSTRAINT knowledge_multimodal_pages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'embedded'::text, 'failed'::text, 'skipped'::text]))),
  PRIMARY KEY (id),
  CONSTRAINT knowledge_multimodal_pages_knowledge_item_id_page_number_key UNIQUE (knowledge_item_id, page_number),
  CONSTRAINT knowledge_multimodal_pages_knowledge_item_id_fkey FOREIGN KEY (knowledge_item_id) REFERENCES public.knowledge_items(id) ON DELETE CASCADE
);

ALTER TABLE public.knowledge_multimodal_pages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.knowledge_multimodal_pages IS 'Step 8: page-level multimodal embeddings for PDF/document items. Opt-in per knowledge_item via has_multimodal flag. Embedding model selected at runtime by capability-resolver rag.multimodal_page (e.g. ColQwen3-4B self-hosted on vLLM).';
