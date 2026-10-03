-- Policy: data_sensitivity_registry read
-- The list of confidential tables is operational governance config — NOT something
-- every authenticated user needs. Read is restricted to admin/staff (operators)
-- and the service role (svc-ai-chat reads it via the SECURITY INVOKER
-- get_data_sensitivity_registry() — RLS, not a definer bypass, governs access).
DROP POLICY IF EXISTS "data_sensitivity_registry read" ON public.data_sensitivity_registry;
CREATE POLICY "data_sensitivity_registry read" ON public.data_sensitivity_registry
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))) OR auth.role() = 'service_role');
