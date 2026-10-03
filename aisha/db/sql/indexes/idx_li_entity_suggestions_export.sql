-- Index: idx_li_entity_suggestions_export
-- Table: li_entity_suggestions

CREATE INDEX IF NOT EXISTS idx_li_entity_suggestions_export ON public.li_entity_suggestions (export_id);
