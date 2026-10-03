-- Policy: Admins can manage transactions

DROP POLICY IF EXISTS "Admins can manage transactions" ON public.token_transactions;
CREATE POLICY "Admins can manage transactions" ON public.token_transactions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
