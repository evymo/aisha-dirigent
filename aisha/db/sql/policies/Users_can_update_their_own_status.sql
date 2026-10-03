-- Policy: Users can update their own status

CREATE POLICY "Users can update their own status" ON public.call_participants
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id));
