-- Policy: Admins can manage leaderboard entries

DROP POLICY IF EXISTS "Admins can manage leaderboard entries" ON public.leaderboard_entries;
CREATE POLICY "Admins can manage leaderboard entries" ON public.leaderboard_entries
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
