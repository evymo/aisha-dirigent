-- Policy: Authenticated users can view leaderboard entries

CREATE POLICY "Authenticated users can view leaderboard entries" ON public.leaderboard_entries
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
