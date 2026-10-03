-- Policy: product_access_rules_staff_read

DROP POLICY IF EXISTS "product_access_rules_staff_read" ON public.product_access_rules;
CREATE POLICY "product_access_rules_staff_read" ON public.product_access_rules
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'staff'::text)));
