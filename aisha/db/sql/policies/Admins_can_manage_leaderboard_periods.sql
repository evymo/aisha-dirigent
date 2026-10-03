-- Policy: Admins can manage leaderboard periods

DROP POLICY IF EXISTS "Admins can manage leaderboard periods" ON public.leaderboard_periods;
CREATE POLICY "Admins can manage leaderboard periods" ON public.leaderboard_periods
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
