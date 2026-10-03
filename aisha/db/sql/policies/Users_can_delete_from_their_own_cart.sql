-- Policy: Users can delete from their own cart

CREATE POLICY "Users can delete from their own cart" ON public.cart_items
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
