-- Policy: Admins can manage lots

DROP POLICY IF EXISTS "Admins can manage lots" ON public.production_lots;
CREATE POLICY "Admins can manage lots" ON public.production_lots
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
