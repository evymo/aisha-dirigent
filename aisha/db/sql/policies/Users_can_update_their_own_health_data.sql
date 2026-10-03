-- Policy: Users can update their own health data

CREATE POLICY "Users can update their own health data" ON public.health_data
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
