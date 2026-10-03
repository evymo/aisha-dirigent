-- Index: idx_li_obligations_export
-- Table: li_obligations

CREATE INDEX IF NOT EXISTS idx_li_obligations_export ON public.li_obligations (export_id);
