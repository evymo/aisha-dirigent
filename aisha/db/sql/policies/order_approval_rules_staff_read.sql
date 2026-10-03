-- Policy: order_approval_rules_staff_read

DROP POLICY IF EXISTS "order_approval_rules_staff_read" ON public.order_approval_rules;
CREATE POLICY "order_approval_rules_staff_read" ON public.order_approval_rules
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'staff'::text)));
