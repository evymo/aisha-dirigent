-- Policy: Users can delete own product logs

CREATE POLICY "Users can delete own product logs" ON public.member_product_logs
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((user_id = auth.uid()));
