-- Policy: Users can view public or own products

CREATE POLICY "Users can view public or own products" ON public.member_products
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((is_public = true) OR (created_by = auth.uid())));
