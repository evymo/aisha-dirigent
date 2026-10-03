-- Index: idx_li_relation_suggestions_source
-- Table: li_relation_suggestions

CREATE INDEX IF NOT EXISTS idx_li_relation_suggestions_source ON public.li_relation_suggestions (ingest_source_slug, record_type);
