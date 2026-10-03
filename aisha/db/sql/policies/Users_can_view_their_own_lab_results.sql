-- Policy: Users can view their own lab results

CREATE POLICY "Users can view their own lab results" ON public.lab_results
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
