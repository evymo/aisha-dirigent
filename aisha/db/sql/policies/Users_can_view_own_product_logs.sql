-- Policy: Users can view own product logs

CREATE POLICY "Users can view own product logs" ON public.member_product_logs
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));
