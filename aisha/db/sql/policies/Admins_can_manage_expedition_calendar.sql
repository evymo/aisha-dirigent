-- Policy: Admins can manage expedition calendar

DROP POLICY IF EXISTS "Admins can manage expedition calendar" ON public.expedition_calendar;
CREATE POLICY "Admins can manage expedition calendar" ON public.expedition_calendar
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
