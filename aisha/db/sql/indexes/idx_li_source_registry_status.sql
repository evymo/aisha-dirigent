-- Index: idx_li_source_registry_status
-- Table: li_source_registry

CREATE INDEX IF NOT EXISTS idx_li_source_registry_status ON public.li_source_registry (status);
