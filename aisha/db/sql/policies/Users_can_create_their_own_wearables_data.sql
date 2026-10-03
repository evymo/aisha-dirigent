-- Policy: Users can create their own wearables data

CREATE POLICY "Users can create their own wearables data" ON public.wearables_data
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
