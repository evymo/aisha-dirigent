-- Policy: Public can view public knowledge topics

CREATE POLICY "Public can view public knowledge topics" ON public.knowledge_topics
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((visibility = 'public'::text));
