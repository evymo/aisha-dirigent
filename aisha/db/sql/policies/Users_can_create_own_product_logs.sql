-- Policy: Users can create own product logs

CREATE POLICY "Users can create own product logs" ON public.member_product_logs
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = auth.uid()));
