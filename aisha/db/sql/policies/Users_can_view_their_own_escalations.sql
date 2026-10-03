-- Policy: Users can view their own escalations

CREATE POLICY "Users can view their own escalations" ON public.message_escalations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
