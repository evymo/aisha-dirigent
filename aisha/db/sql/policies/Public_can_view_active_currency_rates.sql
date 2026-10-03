-- Policy: Public can view active currency rates

CREATE POLICY "Public can view active currency rates" ON public.currency_rates
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
