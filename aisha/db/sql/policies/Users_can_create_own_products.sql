-- Policy: Users can create own products

CREATE POLICY "Users can create own products" ON public.member_products
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((created_by = auth.uid()));
