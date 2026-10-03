-- RLS Policies for expedition_calendar
-- Source of truth: supabase/sql/policies/

-- Admins can manage expedition calendar
DROP POLICY IF EXISTS "Admins can manage expedition calendar" ON public.expedition_calendar;
CREATE POLICY "Admins can manage expedition calendar" ON public.expedition_calendar
  FOR ALL USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
