-- RLS: partner_stories

ALTER TABLE public.partner_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view shared stories" ON public.partner_stories
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.story_participants sp
      WHERE sp.story_id = partner_stories.id
        AND sp.user_id = auth.uid()
    )
  );

-- Stack-default story is the public-facing landing of the stack itself.
-- Visible to every authenticated user (operator, member, partner alike) so
-- that the chat-driven web editor in /storyloop works without requiring an
-- explicit story_participants row. Singleton invariant on is_stack_default
-- enforces at most one such row.
CREATE POLICY "Stack default story visible to all authenticated" ON public.partner_stories
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_stack_default = true);
