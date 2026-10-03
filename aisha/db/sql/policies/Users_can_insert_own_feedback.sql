-- Policy: Users can insert own feedback
-- Table: ai_feedback

CREATE POLICY "Users can insert own feedback"
  ON public.ai_feedback FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
