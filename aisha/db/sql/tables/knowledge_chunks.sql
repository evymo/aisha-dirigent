-- Table: knowledge_chunks

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  knowledge_item_id uuid NOT NULL REFERENCES public.knowledge_items ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  chunk_text text NOT NULL,
  token_count integer,
  section_title text,
  source_field text DEFAULT 'body'::text NOT NULL,
  -- Contextual retrieval columns (migration 20260518210000_contextual_retrieval.sql).
  -- The contextual prefix is an LLM-generated 1–2 sentence summary that gets
  -- concatenated with chunk_text before embedding so retrieval can match on
  -- broader semantic context. Tracking columns enable incremental backfill
  -- + cost analysis + model-version pinning for reproducibility.
  contextual_prefix text,
  contextual_prefix_model text,
  contextual_prefix_model_version text,
  contextual_prefix_generated_at timestamp with time zone,
  contextual_prefix_token_count integer,
  -- RAG locale axis (Brick3). Denormalized from the parent knowledge_item so the
  -- widened unique (knowledge_item_id, chunk_index, locale) lets the same source
  -- chunk coexist across locales. Defaults to the 'global' sentinel; FK →
  -- supported_languages.code (NO ON DELETE CASCADE). source_hash = per-chunk
  -- content key for re-ingestion idempotency.
  locale text NOT NULL DEFAULT 'global',
  source_hash text,
  -- Ingest provenance char-span (PR-1): half-open [char_start, char_end) offsets into
  -- the SOURCE document text so every chunk traces byte-precisely back to its origin
  -- (local-ingest kb_artifact provenance fields are 1:1). Nullable: legacy chunks and
  -- non-span sources stay valid.
  char_start integer,
  char_end integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT knowledge_chunks_char_span_valid CHECK (char_start IS NULL OR char_end IS NULL OR char_end >= char_start),
  PRIMARY KEY (id)
);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
