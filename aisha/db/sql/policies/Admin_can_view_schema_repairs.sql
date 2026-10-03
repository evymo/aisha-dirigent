-- Policy: Admin can view schema repairs

DROP POLICY IF EXISTS "Admin can view schema repairs" ON public.schema_repairs;
CREATE POLICY "Admin can view schema repairs" ON public.schema_repairs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
