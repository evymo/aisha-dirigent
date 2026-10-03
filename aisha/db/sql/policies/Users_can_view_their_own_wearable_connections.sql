-- Policy: Users can view their own wearable connections

CREATE POLICY "Users can view their own wearable connections" ON public.member_wearable_connections
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
