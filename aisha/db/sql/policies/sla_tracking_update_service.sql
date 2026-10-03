-- Policy: sla_tracking_update_service

CREATE POLICY "sla_tracking_update_service" ON public.sla_tracking
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() IS NOT NULL));
