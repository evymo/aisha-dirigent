-- Policy: Admin can manage reminders

DROP POLICY IF EXISTS "Admin can manage reminders" ON public.user_reminders;
CREATE POLICY "Admin can manage reminders" ON public.user_reminders
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
