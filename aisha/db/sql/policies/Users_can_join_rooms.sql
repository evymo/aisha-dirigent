-- Policy: Users can join rooms

CREATE POLICY "Users can join rooms" ON public.call_participants
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
