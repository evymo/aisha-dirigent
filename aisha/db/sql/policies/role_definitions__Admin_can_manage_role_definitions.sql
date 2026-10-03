-- Policy: Admin can manage role definitions

DROP POLICY IF EXISTS "Admin can manage role definitions" ON public.role_definitions;
CREATE POLICY "Admin can manage role definitions" ON public.role_definitions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
