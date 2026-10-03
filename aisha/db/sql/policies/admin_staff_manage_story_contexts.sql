-- Policy: admin_staff_manage_story_contexts

DROP POLICY IF EXISTS "admin_staff_manage_story_contexts" ON public.story_contexts;
CREATE POLICY "admin_staff_manage_story_contexts" ON public.story_contexts
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
