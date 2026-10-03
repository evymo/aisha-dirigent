-- Policy: Staff can manage environments

DROP POLICY IF EXISTS "Staff can manage environments" ON public.story_environments;
CREATE POLICY "Staff can manage environments" ON public.story_environments
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
