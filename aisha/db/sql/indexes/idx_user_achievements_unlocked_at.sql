-- Index: idx_user_achievements_unlocked_at
-- Table: user_achievements

CREATE INDEX idx_user_achievements_unlocked_at ON public.user_achievements USING btree (unlocked_at DESC);
