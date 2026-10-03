-- Policy: sla_tracking_select_own

CREATE POLICY "sla_tracking_select_own" ON public.sla_tracking
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() IS NOT NULL));
