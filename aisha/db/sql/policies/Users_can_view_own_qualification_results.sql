-- Policy: Users can view own qualification results

CREATE POLICY "Users can view own qualification results" ON public.qualification_results
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
