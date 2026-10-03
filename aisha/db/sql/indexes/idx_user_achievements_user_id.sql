-- Index: idx_user_achievements_user_id
-- Table: user_achievements

CREATE INDEX idx_user_achievements_user_id ON public.user_achievements USING btree (user_id);
