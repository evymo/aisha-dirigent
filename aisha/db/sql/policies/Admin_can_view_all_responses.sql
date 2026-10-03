-- Policy: Admin can view all responses

DROP POLICY IF EXISTS "Admin can view all responses" ON public.questionnaire_responses;
CREATE POLICY "Admin can view all responses" ON public.questionnaire_responses
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
