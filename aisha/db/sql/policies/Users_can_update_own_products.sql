-- Policy: Users can update own products

CREATE POLICY "Users can update own products" ON public.member_products
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((created_by = auth.uid()))
  WITH CHECK ((created_by = auth.uid()));
