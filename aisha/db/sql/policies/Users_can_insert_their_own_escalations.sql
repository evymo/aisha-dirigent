-- Policy: Users can insert their own escalations

CREATE POLICY "Users can insert their own escalations" ON public.message_escalations
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = auth.uid()));
