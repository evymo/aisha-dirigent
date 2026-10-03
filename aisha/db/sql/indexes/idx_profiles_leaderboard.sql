-- Index: idx_profiles_leaderboard
-- Table: profiles

CREATE INDEX idx_profiles_leaderboard ON public.profiles USING btree (show_in_leaderboard) WHERE (show_in_leaderboard = true);
