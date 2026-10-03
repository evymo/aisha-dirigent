-- Policy: Public can view packages

CREATE POLICY "Public can view packages" ON public.subscription_packages
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true));
