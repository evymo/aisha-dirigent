-- ============================================================================
-- RLS: ai_budget
-- Mission Control governance — scope-generic AI spend cap.
--
-- Threat model:
--   - Other users must NOT read a scope's spend (usage signal).
--   - Admin/staff/service read ALL rows (ops + Mission Control board).
--   - Story participant reads OWN story's budget row (board chip in story view).
--   - Mutation: service_role only — the audited RPCs own every write.
-- ============================================================================

DROP POLICY IF EXISTS admin_read_all_budget ON public.ai_budget;
CREATE POLICY admin_read_all_budget
  ON public.ai_budget
  FOR SELECT
  TO authenticated
  USING (public.get_jwt_role() IN ('admin', 'staff', 'service_role'));

DROP POLICY IF EXISTS participant_read_own_story_budget ON public.ai_budget;
CREATE POLICY participant_read_own_story_budget
  ON public.ai_budget
  FOR SELECT
  TO authenticated
  USING (
    scope_type = 'story'
    AND EXISTS (
      SELECT 1 FROM public.story_participants sp
      WHERE sp.story_id = ai_budget.scope_id
        AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS service_role_write_budget ON public.ai_budget;
CREATE POLICY service_role_write_budget
  ON public.ai_budget
  FOR ALL
  TO authenticated
  USING (public.get_jwt_role() = 'service_role')
  WITH CHECK (public.get_jwt_role() = 'service_role');
