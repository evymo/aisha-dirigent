-- RLS: ai_decision_candidates
-- Source of truth pair: aisha/db/sql/tables/ai_decision_candidates.sql
-- DROP+CREATE-guarded (the heal-reconcile convention) so re-applying on every cold-start is
-- idempotent. Reads chain through the parent ai_decisions row; writes go through the SECURITY
-- DEFINER fn_record_execution_decision only (no write policy needed).

ALTER TABLE public.ai_decision_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_staff_read_ai_decision_candidates" ON public.ai_decision_candidates;
CREATE POLICY "admin_staff_read_ai_decision_candidates" ON public.ai_decision_candidates
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "participant_read_ai_decision_candidates" ON public.ai_decision_candidates;
CREATE POLICY "participant_read_ai_decision_candidates" ON public.ai_decision_candidates
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_decisions d
      WHERE d.id = ai_decision_candidates.decision_id
        AND (
          EXISTS (
            SELECT 1 FROM public.story_participants sp
            WHERE sp.story_id = d.story_id AND sp.user_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.partner_stories ps
            WHERE ps.id = d.story_id AND ps.is_stack_default = true
          )
        )
    )
  );
