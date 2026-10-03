-- Index: idx_li_obligations_status
-- Table: li_obligations

CREATE INDEX IF NOT EXISTS idx_li_obligations_status ON public.li_obligations (candidate_status);
