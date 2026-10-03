-- Policy: Admins can manage distribution calendar

DROP POLICY IF EXISTS "Admins can manage distribution calendar" ON public.distribution_calendar;
CREATE POLICY "Admins can manage distribution calendar" ON public.distribution_calendar
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
