-- Policy: Admin can manage achievements

DROP POLICY IF EXISTS "Admin can manage achievements" ON public.user_achievements;
CREATE POLICY "Admin can manage achievements" ON public.user_achievements
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
