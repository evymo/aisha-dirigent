-- RLS Policies for distribution_forecasts
-- Source of truth: supabase/sql/policies/

-- Admins can manage forecasts
DROP POLICY IF EXISTS "Admins can manage forecasts" ON public.distribution_forecasts;
CREATE POLICY "Admins can manage forecasts" ON public.distribution_forecasts
  FOR ALL USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
