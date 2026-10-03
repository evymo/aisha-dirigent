-- Policy: Admins can manage knowledge moderation queue

DROP POLICY IF EXISTS "Admins can manage knowledge moderation queue" ON public.knowledge_moderation_queue;
CREATE POLICY "Admins can manage knowledge moderation queue" ON public.knowledge_moderation_queue
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
