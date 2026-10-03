-- Policy: Users can manage own preferences

CREATE POLICY "Users can manage own preferences" ON public.user_shipment_preferences
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.uid() = user_id));
