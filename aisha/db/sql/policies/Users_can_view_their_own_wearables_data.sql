-- Policy: Users can view their own wearables data

CREATE POLICY "Users can view their own wearables data" ON public.wearables_data
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
