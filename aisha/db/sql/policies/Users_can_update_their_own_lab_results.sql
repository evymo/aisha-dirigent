-- Policy: Users can update their own lab results

CREATE POLICY "Users can update their own lab results" ON public.lab_results
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
