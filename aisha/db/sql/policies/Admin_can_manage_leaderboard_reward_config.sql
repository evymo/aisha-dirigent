-- Policy: Admin can manage leaderboard reward config

DROP POLICY IF EXISTS "Admin can manage leaderboard reward config" ON public.leaderboard_reward_config;
CREATE POLICY "Admin can manage leaderboard reward config" ON public.leaderboard_reward_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));
