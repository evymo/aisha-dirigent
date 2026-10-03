-- Policy: Users can manage their own responses

CREATE POLICY "Users can manage their own responses" ON public.onboarding_responses
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((user_id = auth.uid()));
