-- Policy: Members can view member knowledge topics

CREATE POLICY "Members can view member knowledge topics" ON public.knowledge_topics
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.role() = 'authenticated'::text) AND (visibility = ANY (ARRAY['public'::text, 'members'::text]))));
