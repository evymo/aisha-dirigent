-- Policy: admin_staff_manage_story_rulesets

DROP POLICY IF EXISTS "admin_staff_manage_story_rulesets" ON public.story_rulesets;
CREATE POLICY "admin_staff_manage_story_rulesets" ON public.story_rulesets
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
