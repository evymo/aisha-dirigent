-- Policy: sla_tracking_insert_service

CREATE POLICY "sla_tracking_insert_service" ON public.sla_tracking
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() IS NOT NULL));
