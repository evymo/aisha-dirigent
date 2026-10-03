-- Policy: Users can create own product plans

CREATE POLICY "Users can create own product plans" ON public.member_product_plans
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = auth.uid()));
