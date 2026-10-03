-- Policy: Admin can manage schema repairs

DROP POLICY IF EXISTS "Admin can manage schema repairs" ON public.schema_repairs;
CREATE POLICY "Admin can manage schema repairs" ON public.schema_repairs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
