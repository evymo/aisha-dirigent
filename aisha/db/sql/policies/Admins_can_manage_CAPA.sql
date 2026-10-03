-- Policy: Admins can manage CAPA

DROP POLICY IF EXISTS "Admins can manage CAPA" ON public.production_capa;
CREATE POLICY "Admins can manage CAPA" ON public.production_capa
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
