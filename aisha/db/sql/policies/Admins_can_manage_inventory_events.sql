-- Policy: Admins can manage inventory events

DROP POLICY IF EXISTS "Admins can manage inventory events" ON public.production_inventory_events;
CREATE POLICY "Admins can manage inventory events" ON public.production_inventory_events
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
