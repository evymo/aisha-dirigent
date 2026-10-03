-- Policy: Admins can view all preferences

DROP POLICY IF EXISTS "Admins can view all preferences" ON public.notification_preferences;
CREATE POLICY "Admins can view all preferences" ON public.notification_preferences
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
