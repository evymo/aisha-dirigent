-- Policy: Admin can view all completions

DROP POLICY IF EXISTS "Admin can view all completions" ON public.reminder_completions;
CREATE POLICY "Admin can view all completions" ON public.reminder_completions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
