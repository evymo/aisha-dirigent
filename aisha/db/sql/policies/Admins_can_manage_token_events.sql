-- Policy: Admins can manage token events

DROP POLICY IF EXISTS "Admins can manage token events" ON public.production_token_events;
CREATE POLICY "Admins can manage token events" ON public.production_token_events
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
