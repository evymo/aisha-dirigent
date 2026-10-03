-- Policy: Users can update own product plans

CREATE POLICY "Users can update own product plans" ON public.member_product_plans
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
