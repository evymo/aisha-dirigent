-- Policy: Admins can view all rate limits

DROP POLICY IF EXISTS "Admins can view all rate limits" ON public.api_rate_limits;
CREATE POLICY "Admins can view all rate limits" ON public.api_rate_limits
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
