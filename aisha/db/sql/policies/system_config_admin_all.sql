-- Policy: system_config_admin_all

DROP POLICY IF EXISTS "system_config_admin_all" ON public.system_config;
CREATE POLICY "system_config_admin_all" ON public.system_config
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
