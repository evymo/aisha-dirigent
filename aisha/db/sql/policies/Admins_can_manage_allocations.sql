-- Policy: Admins can manage allocations

DROP POLICY IF EXISTS "Admins can manage allocations" ON public.token_allocations;
CREATE POLICY "Admins can manage allocations" ON public.token_allocations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
