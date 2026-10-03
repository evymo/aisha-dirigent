-- Policy: graph_nodes admin staff read
-- Step:   Step 7 (Hippocampus Graph RAG)
-- Patched by: aisha/db/migrations/20260519030000_fix_owner_user_id_typo.sql
--             (ps.owner_user_id → ps.user_id — partner_stories.owner_user_id
--             was never a column; the canonical owner reference is user_id).
-- Patched by: aisha/db/migrations/20260520060000_rbac_4clause_unification.sql
--             (added is_stack_default clause so the predicate matches the
--             workbench Phase 6/7 canonical pattern).

DROP POLICY IF EXISTS "graph_nodes admin staff read" ON public.graph_nodes;
CREATE POLICY "graph_nodes admin staff read" ON public.graph_nodes
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.is_admin_or_staff((SELECT auth.uid())))
    OR story_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.partner_stories ps
       WHERE ps.id = graph_nodes.story_id
         AND (
           ps.is_stack_default = true
           OR ps.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.story_participants sp
              WHERE sp.story_id = ps.id AND sp.user_id = auth.uid()
           )
         )
    )
  );
