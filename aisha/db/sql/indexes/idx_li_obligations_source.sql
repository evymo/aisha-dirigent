-- Index: idx_li_obligations_source
-- Table: li_obligations

CREATE INDEX IF NOT EXISTS idx_li_obligations_source ON public.li_obligations (source_sha256);
