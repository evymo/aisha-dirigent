-- Policy: Users can view their own tracked actions

CREATE POLICY "Users can view their own tracked actions" ON public.tracked_actions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
