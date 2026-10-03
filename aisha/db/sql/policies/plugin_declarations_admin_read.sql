-- Idempotentní: baseline politiku založí, heals ji přehrává znovu.
-- Zápis jen služba (record_plugin_declaration, SECURITY DEFINER); číst smí správa.
DROP POLICY IF EXISTS "plugin_declarations_admin_read" ON public.plugin_declarations;
CREATE POLICY "plugin_declarations_admin_read" ON public.plugin_declarations
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
