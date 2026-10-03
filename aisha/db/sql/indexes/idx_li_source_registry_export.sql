-- Index: idx_li_source_registry_export
-- Table: li_source_registry

CREATE INDEX IF NOT EXISTS idx_li_source_registry_export ON public.li_source_registry (export_id);
