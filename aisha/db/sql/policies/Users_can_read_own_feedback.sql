-- Policy: Users can read own feedback
-- Table: ai_feedback

CREATE POLICY "Users can read own feedback"
  ON public.ai_feedback FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
