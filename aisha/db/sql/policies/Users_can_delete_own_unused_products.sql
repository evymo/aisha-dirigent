-- Policy: Users can delete own unused products

CREATE POLICY "Users can delete own unused products" ON public.member_products
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((created_by = auth.uid()) AND (usage_count = 0)));
