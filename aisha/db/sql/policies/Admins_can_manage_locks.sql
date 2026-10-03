-- Policy: Admins can manage locks

DROP POLICY IF EXISTS "Admins can manage locks" ON public.token_locks;
CREATE POLICY "Admins can manage locks" ON public.token_locks
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
