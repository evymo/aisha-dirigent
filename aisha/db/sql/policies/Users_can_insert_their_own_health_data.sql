-- Policy: Users can insert their own health data

CREATE POLICY "Users can insert their own health data" ON public.health_data
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));
