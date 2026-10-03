-- Policy: Admins can manage token production events

DROP POLICY IF EXISTS "Admins can manage token production events" ON public.token_production_events;
CREATE POLICY "Admins can manage token production events" ON public.token_production_events
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
