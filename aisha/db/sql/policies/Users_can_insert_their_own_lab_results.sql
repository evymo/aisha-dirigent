-- Policy: Users can insert their own lab results

CREATE POLICY "Users can insert their own lab results" ON public.lab_results
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));
