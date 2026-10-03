-- Policy: Admin staff can read all feedback
-- Table: ai_feedback

DROP POLICY IF EXISTS "Admin staff can read all feedback" ON public.ai_feedback;
CREATE POLICY "Admin staff can read all feedback"
  ON public.ai_feedback FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
