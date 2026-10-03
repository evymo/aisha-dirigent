-- Policy: Users can view own responses

CREATE POLICY "Users can view own responses" ON public.questionnaire_responses
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
