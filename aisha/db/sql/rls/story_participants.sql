-- RLS: story_participants
-- Policies use the SECURITY DEFINER helpers public.is_story_participant /
-- public.is_story_partner instead of a self-referential subquery on
-- story_participants — the self-reference caused 42P17 infinite recursion and
-- was fixed in migration 20260530130000_fix_story_participants_rls_recursion.
-- That fix lives here in the SoT so the regenerated baseline is correct on its
-- own (the migration's ALTER POLICY is skipped once the baseline carries the fix).

ALTER TABLE public.story_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_can_add_participants" ON public.story_participants;
CREATE POLICY "owner_can_add_participants" ON public.story_participants
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_story_partner((SELECT auth.uid()), story_id))
    OR (SELECT public.is_admin_or_staff())
  );

DROP POLICY IF EXISTS "owner_or_self_can_remove_participants" ON public.story_participants;
CREATE POLICY "owner_or_self_can_remove_participants" ON public.story_participants
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT public.is_story_partner((SELECT auth.uid()), story_id))
    OR (SELECT public.is_admin_or_staff())
  );

DROP POLICY IF EXISTS "participants_can_view_roster" ON public.story_participants;
CREATE POLICY "participants_can_view_roster" ON public.story_participants
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (SELECT public.is_story_participant((SELECT auth.uid()), story_id))
    OR (SELECT public.is_admin_or_staff())
  );
