-- Index: idx_leaderboard_periods_dates
-- Table: leaderboard_periods

CREATE INDEX idx_leaderboard_periods_dates ON public.leaderboard_periods USING btree (period_start, period_end);
