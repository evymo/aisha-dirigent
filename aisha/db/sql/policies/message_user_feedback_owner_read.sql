-- Policy: message_user_feedback owner read

DROP POLICY IF EXISTS "message_user_feedback owner read" ON public.message_user_feedback;
CREATE POLICY "message_user_feedback owner read" ON public.message_user_feedback
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR (SELECT is_admin_or_staff((SELECT auth.uid())))));
