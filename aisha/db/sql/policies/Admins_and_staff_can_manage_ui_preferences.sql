-- Policy: Admins and staff can manage ui preferences

DROP POLICY IF EXISTS "Admins and staff can manage ui preferences" ON public.user_ui_preferences;
CREATE POLICY "Admins and staff can manage ui preferences" ON public.user_ui_preferences
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
