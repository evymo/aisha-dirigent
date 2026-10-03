-- Policy: graph_edges admin staff read
-- Step:   Step 7 (Hippocampus Graph RAG)

DROP POLICY IF EXISTS "graph_edges admin staff read" ON public.graph_edges;
CREATE POLICY "graph_edges admin staff read" ON public.graph_edges
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin_or_staff((SELECT auth.uid()))));
