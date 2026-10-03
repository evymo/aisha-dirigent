-- Policy: Users can view their own health data

CREATE POLICY "Users can view their own health data" ON public.health_data
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
