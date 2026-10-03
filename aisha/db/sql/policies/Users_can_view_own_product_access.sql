-- Policy: Users can view own product access

CREATE POLICY "Users can view own product access" ON public.product_access
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
