-- Index: idx_longevity_scores_created_at
-- Table: longevity_scores

CREATE INDEX IF NOT EXISTS idx_longevity_scores_created_at ON public.longevity_scores(created_at DESC);
