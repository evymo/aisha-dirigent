-- Policy: Users can delete own responses

CREATE POLICY "Users can delete own responses" ON public.questionnaire_responses
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
