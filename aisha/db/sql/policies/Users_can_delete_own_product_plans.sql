-- Policy: Users can delete own product plans

CREATE POLICY "Users can delete own product plans" ON public.member_product_plans
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((user_id = auth.uid()));
