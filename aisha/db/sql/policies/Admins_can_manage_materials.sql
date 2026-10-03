-- Policy: Admins can manage materials

DROP POLICY IF EXISTS "Admins can manage materials" ON public.production_materials;
CREATE POLICY "Admins can manage materials" ON public.production_materials
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
