-- Policy: Authenticated users can view leaderboard periods

CREATE POLICY "Authenticated users can view leaderboard periods" ON public.leaderboard_periods
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
