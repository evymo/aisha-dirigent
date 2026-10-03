-- Policy: aitg_aisha_reflections_read_admin ON public.aitg_aisha_reflections
-- Auto-extracted (back-port reconciliation)

DROP POLICY IF EXISTS "aitg_aisha_reflections_read_admin" ON public.aitg_aisha_reflections;
CREATE POLICY "aitg_aisha_reflections_read_admin" ON public.aitg_aisha_reflections AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT is_admin_or_staff()));
