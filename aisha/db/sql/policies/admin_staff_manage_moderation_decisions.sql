-- Policy: admin_staff_manage_moderation_decisions

DROP POLICY IF EXISTS "admin_staff_manage_moderation_decisions" ON public.moderation_decisions;
CREATE POLICY "admin_staff_manage_moderation_decisions" ON public.moderation_decisions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
