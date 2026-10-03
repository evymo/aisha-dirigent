-- RLS Policies for distribution_schedule_orders
-- Source of truth: supabase/sql/policies/

-- Admins can manage schedule orders
DROP POLICY IF EXISTS "Admins can manage schedule orders" ON public.distribution_schedule_orders;
CREATE POLICY "Admins can manage schedule orders" ON public.distribution_schedule_orders
  FOR ALL USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
