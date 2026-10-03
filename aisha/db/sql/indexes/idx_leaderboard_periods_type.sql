-- Index: idx_leaderboard_periods_type
-- Table: leaderboard_periods

CREATE INDEX idx_leaderboard_periods_type ON public.leaderboard_periods USING btree (period_type);
