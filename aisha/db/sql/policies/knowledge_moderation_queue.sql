-- RLS Policies for knowledge_moderation_queue
-- Source of truth: supabase/sql/policies/

-- Only admins can access the moderation queue
DROP POLICY IF EXISTS "Admins can manage knowledge moderation queue" ON public.knowledge_moderation_queue;
CREATE POLICY "Admins can manage knowledge moderation queue" ON public.knowledge_moderation_queue
  FOR ALL USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
