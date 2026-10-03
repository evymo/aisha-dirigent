-- RLS Policies for distribution_calendar
-- Source of truth: supabase/sql/policies/

-- Admins can manage distribution calendar
DROP POLICY IF EXISTS "Admins can manage distribution calendar" ON public.distribution_calendar;
CREATE POLICY "Admins can manage distribution calendar" ON public.distribution_calendar
  FOR ALL USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
