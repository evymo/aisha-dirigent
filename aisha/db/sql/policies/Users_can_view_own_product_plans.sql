-- Policy: Users can view own product plans

CREATE POLICY "Users can view own product plans" ON public.member_product_plans
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));
