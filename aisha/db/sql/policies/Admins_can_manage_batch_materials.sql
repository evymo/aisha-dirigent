-- Policy: Admins can manage batch materials

DROP POLICY IF EXISTS "Admins can manage batch materials" ON public.production_batch_materials;
CREATE POLICY "Admins can manage batch materials" ON public.production_batch_materials
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
