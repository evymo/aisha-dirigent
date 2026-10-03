-- Policy: Admin/staff can manage model registry

DROP POLICY IF EXISTS "Admin/staff can manage model registry" ON public.ai_model_registry;
CREATE POLICY "Admin/staff can manage model registry" ON public.ai_model_registry
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));
