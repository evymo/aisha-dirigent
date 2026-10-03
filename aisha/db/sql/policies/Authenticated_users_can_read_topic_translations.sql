-- Policy: Authenticated users can read topic translations

CREATE POLICY "Authenticated users can read topic translations" ON public.knowledge_topic_translations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
