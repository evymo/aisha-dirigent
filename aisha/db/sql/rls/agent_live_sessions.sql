-- RLS: agent_live_sessions
-- Source of truth pair: aisha/db/sql/tables/agent_live_sessions.sql
-- Policies live in rls/ (emitted AFTER functions in the baseline) so the
-- functions they reference (is_admin_or_staff, auth.role) exist when the
-- policy binds — inline-in-table placement breaks cold-start ordering.

ALTER TABLE public.agent_live_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_live_sessions owner read" ON public.agent_live_sessions;
CREATE POLICY "agent_live_sessions owner read" ON public.agent_live_sessions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT public.is_admin_or_staff((SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "agent_live_sessions service full" ON public.agent_live_sessions;
CREATE POLICY "agent_live_sessions service full" ON public.agent_live_sessions
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
