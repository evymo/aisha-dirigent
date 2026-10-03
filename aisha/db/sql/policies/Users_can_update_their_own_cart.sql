-- Policy: Users can update their own cart

CREATE POLICY "Users can update their own cart" ON public.cart_items
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
