-- Policy: admin_staff_manage_moderation_sessions

DROP POLICY IF EXISTS "admin_staff_manage_moderation_sessions" ON public.moderation_sessions;
CREATE POLICY "admin_staff_manage_moderation_sessions" ON public.moderation_sessions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
