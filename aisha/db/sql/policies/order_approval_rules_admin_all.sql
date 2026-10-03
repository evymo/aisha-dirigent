-- Policy: order_approval_rules_admin_all

DROP POLICY IF EXISTS "order_approval_rules_admin_all" ON public.order_approval_rules;
CREATE POLICY "order_approval_rules_admin_all" ON public.order_approval_rules
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
