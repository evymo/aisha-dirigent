-- Policy: Users can update their own wearables data

CREATE POLICY "Users can update their own wearables data" ON public.wearables_data
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
