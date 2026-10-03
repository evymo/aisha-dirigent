-- Policy: Users can update own responses

CREATE POLICY "Users can update own responses" ON public.questionnaire_responses
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
