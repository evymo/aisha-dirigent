-- RLS policies for web_artifact_jobs
-- Admin/staff: full access. Story participants: SELECT/INSERT/UPDATE jen na své story.

DROP POLICY IF EXISTS "Admin and staff can read all web artifact jobs" ON public.web_artifact_jobs;
CREATE POLICY "Admin and staff can read all web artifact jobs"
ON public.web_artifact_jobs FOR SELECT TO authenticated
USING ((SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "Story participants can read their web artifact jobs" ON public.web_artifact_jobs;
CREATE POLICY "Story participants can read their web artifact jobs"
ON public.web_artifact_jobs FOR SELECT TO authenticated
USING (story_id IS NOT NULL AND (SELECT public.is_story_participant((SELECT auth.uid()), story_id)));

DROP POLICY IF EXISTS "Admin and staff can insert web artifact jobs" ON public.web_artifact_jobs;
CREATE POLICY "Admin and staff can insert web artifact jobs"
ON public.web_artifact_jobs FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "Story participants can insert their web artifact jobs" ON public.web_artifact_jobs;
CREATE POLICY "Story participants can insert their web artifact jobs"
ON public.web_artifact_jobs FOR INSERT TO authenticated
WITH CHECK (story_id IS NOT NULL AND (SELECT public.is_story_participant((SELECT auth.uid()), story_id)));

DROP POLICY IF EXISTS "Admin and staff can update web artifact jobs" ON public.web_artifact_jobs;
CREATE POLICY "Admin and staff can update web artifact jobs"
ON public.web_artifact_jobs FOR UPDATE TO authenticated
USING ((SELECT public.is_admin_or_staff()));
