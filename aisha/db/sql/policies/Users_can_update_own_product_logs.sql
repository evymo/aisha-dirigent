-- Policy: Users can update own product logs

CREATE POLICY "Users can update own product logs" ON public.member_product_logs
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
