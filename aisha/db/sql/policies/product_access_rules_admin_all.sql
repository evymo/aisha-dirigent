-- Policy: product_access_rules_admin_all

DROP POLICY IF EXISTS "product_access_rules_admin_all" ON public.product_access_rules;
CREATE POLICY "product_access_rules_admin_all" ON public.product_access_rules
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
