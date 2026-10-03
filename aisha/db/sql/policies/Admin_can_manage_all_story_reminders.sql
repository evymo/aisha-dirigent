-- Policy: Admin can manage all story reminders

DROP POLICY IF EXISTS "Admin can manage all story reminders" ON public.story_reminders;
CREATE POLICY "Admin can manage all story reminders" ON public.story_reminders
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
