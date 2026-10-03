-- Table: knowledge_embeddings

CREATE TABLE IF NOT EXISTS public.knowledge_embeddings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  chunk_id uuid NOT NULL,
  knowledge_item_id uuid NOT NULL REFERENCES public.knowledge_items ON DELETE CASCADE,
  embedding vector(1024) NOT NULL,
  model text DEFAULT 'text-embedding-3-small'::text NOT NULL,
  model_version text,
  -- Brick2-guard model identity: FK from the human-readable `model` text mirror to the
  -- canonical ai_model_registry row that produced this vector. The text columns stay as
  -- the readable mirror; ai_model_registry has no single-col unique on model_id so a text
  -- FK is impossible — these uuid cols carry the identity link. NULLABLE (legacy rows +
  -- deferred backfill) and NO ON DELETE CASCADE (pattern: training_jobs.adapter_model_id)
  -- — deprecating a model must NEVER cascade-delete the corpus it embedded.
  model_registry_id uuid REFERENCES public.ai_model_registry(id),
  model_v2_registry_id uuid REFERENCES public.ai_model_registry(id),
  -- Embedding v2 (Qwen3, 2560-dim) parallel columns for migration.
  -- Migration 20260518230000_embedding_v2_qwen3.sql; backfill workers write
  -- here while the legacy 1536-dim column stays in service. Once v2 is at
  -- 100% coverage the v1 columns can be dropped in a separate forward
  -- migration.
  embedding_v2 halfvec(2560),
  model_v2 text,
  model_v2_version text,
  v2_generated_at timestamp with time zone,
  v2_status text DEFAULT 'pending'
    CHECK (v2_status IN ('pending', 'generated', 'failed', 'skipped')),
  -- RAG locale axis (Brick3). Denormalized from the parent chunk so the widened
  -- unique (chunk_id, locale) lets per-locale embeddings of one chunk coexist.
  -- Defaults to the 'global' sentinel; FK → supported_languages.code (NO ON
  -- DELETE CASCADE). No source_hash here (lives on chunks/items).
  locale text NOT NULL DEFAULT 'global',
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.knowledge_embeddings ENABLE ROW LEVEL SECURITY;
