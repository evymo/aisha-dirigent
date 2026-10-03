-- Policy: Admins can manage distribution schedule

DROP POLICY IF EXISTS "Admins can manage distribution schedule" ON public.user_distribution_schedule;
CREATE POLICY "Admins can manage distribution schedule" ON public.user_distribution_schedule
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
