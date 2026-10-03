-- Policy: Authenticated can read inventory events

CREATE POLICY "Authenticated can read inventory events" ON public.production_inventory_events
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
