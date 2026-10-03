-- Policy: system_config_staff_read

DROP POLICY IF EXISTS "system_config_staff_read" ON public.system_config;
CREATE POLICY "system_config_staff_read" ON public.system_config
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'staff'::text)));
