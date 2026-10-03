-- Policy: Users can insert their own dosing logs

CREATE POLICY "Users can insert their own dosing logs" ON public.dosing_logs
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));
