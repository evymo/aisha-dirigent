-- Policy: Users can delete their own wearables data

CREATE POLICY "Users can delete their own wearables data" ON public.wearables_data
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
