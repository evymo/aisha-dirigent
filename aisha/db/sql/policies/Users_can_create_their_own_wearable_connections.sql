-- Policy: Users can create their own wearable connections

CREATE POLICY "Users can create their own wearable connections" ON public.member_wearable_connections
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
