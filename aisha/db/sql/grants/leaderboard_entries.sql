-- Grants: leaderboard_entries

GRANT SELECT ON public.leaderboard_entries TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.leaderboard_entries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leaderboard_entries TO service_role;
