-- Policy: Users can add to their own cart

CREATE POLICY "Users can add to their own cart" ON public.cart_items
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
