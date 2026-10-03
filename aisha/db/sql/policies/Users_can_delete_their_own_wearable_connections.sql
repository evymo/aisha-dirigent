-- Policy: Users can delete their own wearable connections

CREATE POLICY "Users can delete their own wearable connections" ON public.member_wearable_connections
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
