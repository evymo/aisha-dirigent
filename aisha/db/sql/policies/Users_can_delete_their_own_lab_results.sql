-- Policy: Users can delete their own lab results

CREATE POLICY "Users can delete their own lab results" ON public.lab_results
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((user_id = auth.uid()));
