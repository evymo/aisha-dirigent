-- Policy: Users can update their own wearable connections

CREATE POLICY "Users can update their own wearable connections" ON public.member_wearable_connections
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
