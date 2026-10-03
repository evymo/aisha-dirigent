-- Index: idx_leaderboard_entries_period
-- Table: leaderboard_entries

CREATE INDEX idx_leaderboard_entries_period ON public.leaderboard_entries USING btree (period_id, rank);
