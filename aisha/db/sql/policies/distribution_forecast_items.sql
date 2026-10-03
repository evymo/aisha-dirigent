-- RLS Policies for distribution_forecast_items
-- Source of truth: supabase/sql/policies/

-- Admins can manage forecast items
DROP POLICY IF EXISTS "Admins can manage forecast items" ON public.distribution_forecast_items;
CREATE POLICY "Admins can manage forecast items" ON public.distribution_forecast_items
  FOR ALL USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
