-- Policy: Admins can manage currency rates

DROP POLICY IF EXISTS "Admins can manage currency rates" ON public.currency_rates;
CREATE POLICY "Admins can manage currency rates" ON public.currency_rates
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
