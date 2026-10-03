-- Policy: Admins can manage all compensations

DROP POLICY IF EXISTS "Admins can manage all compensations" ON public.placebo_compensations;
CREATE POLICY "Admins can manage all compensations" ON public.placebo_compensations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
