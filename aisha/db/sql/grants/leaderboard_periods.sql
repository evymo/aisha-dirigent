-- Grants: leaderboard_periods

GRANT SELECT ON public.leaderboard_periods TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.leaderboard_periods TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leaderboard_periods TO service_role;
