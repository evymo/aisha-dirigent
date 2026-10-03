-- Index: idx_longevity_scores_user_id
-- Table: longevity_scores

CREATE INDEX IF NOT EXISTS idx_longevity_scores_user_id ON public.longevity_scores(user_id);
