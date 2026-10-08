-- Grants: leaderboard_reward_config

GRANT SELECT ON public.leaderboard_reward_config TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.leaderboard_reward_config TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.leaderboard_reward_config TO service_role;
