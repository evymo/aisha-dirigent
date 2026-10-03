-- Policy: Admins can manage schedule orders

DROP POLICY IF EXISTS "Admins can manage schedule orders" ON public.distribution_schedule_orders;
CREATE POLICY "Admins can manage schedule orders" ON public.distribution_schedule_orders
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
