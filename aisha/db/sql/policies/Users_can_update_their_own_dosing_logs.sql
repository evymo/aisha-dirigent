-- Policy: Users can update their own dosing logs

CREATE POLICY "Users can update their own dosing logs" ON public.dosing_logs
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
