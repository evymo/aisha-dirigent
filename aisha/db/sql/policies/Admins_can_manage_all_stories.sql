-- Policy: Admins can manage all stories

DROP POLICY IF EXISTS "Admins can manage all stories" ON public.partner_stories;
CREATE POLICY "Admins can manage all stories" ON public.partner_stories
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
