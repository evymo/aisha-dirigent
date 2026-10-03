-- RLS Policies for story_links
-- Enables row-level security for cross-story collaboration links.

ALTER TABLE public.story_links ENABLE ROW LEVEL SECURITY;

-- Admin/Staff: full access to all story links
DROP POLICY IF EXISTS "admin_staff_manage_story_links" ON public.story_links;
CREATE POLICY "admin_staff_manage_story_links" ON public.story_links
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));

-- Participants: can see links where they participate in either story
DROP POLICY IF EXISTS "participant_select_own_story_links" ON public.story_links;
CREATE POLICY "participant_select_own_story_links" ON public.story_links
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    (SELECT is_story_participant((SELECT auth.uid()), source_story_id))
    OR (SELECT is_story_participant((SELECT auth.uid()), target_story_id))
  );

-- Participants: can create links from stories they participate in
DROP POLICY IF EXISTS "participant_insert_story_links" ON public.story_links;
CREATE POLICY "participant_insert_story_links" ON public.story_links
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT is_story_participant((SELECT auth.uid()), source_story_id))
    AND created_by = auth.uid()
  );

-- Participants: can update links for stories they participate in (accept/dismiss)
DROP POLICY IF EXISTS "participant_update_story_links" ON public.story_links;
CREATE POLICY "participant_update_story_links" ON public.story_links
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT is_story_participant((SELECT auth.uid()), source_story_id))
    OR (SELECT is_story_participant((SELECT auth.uid()), target_story_id))
  )
  WITH CHECK (
    (SELECT is_story_participant((SELECT auth.uid()), source_story_id))
    OR (SELECT is_story_participant((SELECT auth.uid()), target_story_id))
  );


-- RLS Policies for collaboration_preferences

ALTER TABLE public.collaboration_preferences ENABLE ROW LEVEL SECURITY;

-- Admin/Staff: full access to all preferences
DROP POLICY IF EXISTS "admin_staff_manage_collab_preferences" ON public.collaboration_preferences;
CREATE POLICY "admin_staff_manage_collab_preferences" ON public.collaboration_preferences
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));

-- Users: can read their own preferences
DROP POLICY IF EXISTS "user_select_own_collab_preferences" ON public.collaboration_preferences;
CREATE POLICY "user_select_own_collab_preferences" ON public.collaboration_preferences
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users: can insert their own preferences
DROP POLICY IF EXISTS "user_insert_own_collab_preferences" ON public.collaboration_preferences;
CREATE POLICY "user_insert_own_collab_preferences" ON public.collaboration_preferences
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users: can update their own preferences
DROP POLICY IF EXISTS "user_update_own_collab_preferences" ON public.collaboration_preferences;
CREATE POLICY "user_update_own_collab_preferences" ON public.collaboration_preferences
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users: can delete their own preferences
DROP POLICY IF EXISTS "user_delete_own_collab_preferences" ON public.collaboration_preferences;
CREATE POLICY "user_delete_own_collab_preferences" ON public.collaboration_preferences
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
