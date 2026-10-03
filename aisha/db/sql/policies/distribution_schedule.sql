-- RLS Policies for distribution_schedule
-- Source of truth: supabase/sql/policies/

-- Admins can manage distribution schedule
DROP POLICY IF EXISTS "Admins can manage distribution schedule" ON public.distribution_schedule;
CREATE POLICY "Admins can manage distribution schedule" ON public.distribution_schedule
  FOR ALL USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
