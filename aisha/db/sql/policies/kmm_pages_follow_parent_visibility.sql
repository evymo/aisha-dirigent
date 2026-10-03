-- Policy: kmm_pages follow parent visibility

CREATE POLICY "kmm_pages follow parent visibility" ON public.knowledge_multimodal_pages
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1 FROM knowledge_items ki WHERE ((ki.id = knowledge_multimodal_pages.knowledge_item_id) AND (ki.status = 'active'::text) AND (ki.quarantine_status <> ALL (ARRAY['flagged'::text, 'quarantined'::text]))))));
