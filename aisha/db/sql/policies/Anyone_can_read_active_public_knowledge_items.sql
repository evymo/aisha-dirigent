-- Policy: Anyone can read active public knowledge items
--
-- story_id IS NULL is REQUIRED: "public" here means GLOBAL/curated knowledge only
-- (brain layers, domain docs). visibility DEFAULTs to 'public', so without this gate a
-- story-scoped (user-uploaded, potentially PII) item with the default visibility was
-- world-readable by ANY authenticated/anon caller via the table API — the per-story
-- policy ("Per-story KB visible to participants") could not claw it back because
-- PERMISSIVE policies are OR'd. Story-scoped items now fall ONLY to the per-story
-- policy (owner / participant / admin / brain-layer item_types). See pgTAP D7/D8/D9 in
-- aisha/db/tests/schema/02_rag_isolation_rbac.sql.

CREATE POLICY "Anyone can read active public knowledge items" ON public.knowledge_items
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((status = 'active'::text) AND (visibility = ANY (ARRAY['public'::text, 'members'::text])) AND (story_id IS NULL)));
