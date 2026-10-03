-- Policy: Users can view their own dosing logs

CREATE POLICY "Users can view their own dosing logs" ON public.dosing_logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
