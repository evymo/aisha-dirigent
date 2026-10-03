-- Policy: Users can insert own responses

CREATE POLICY "Users can insert own responses" ON public.questionnaire_responses
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
