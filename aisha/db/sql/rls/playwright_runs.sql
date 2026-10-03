-- RLS for playwright_runs.
-- Admin/staff can do everything; service_role writes via dedicated RPCs;
-- regular authenticated users have NO read (CI/audit only).
ALTER TABLE public.playwright_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin and staff can read playwright runs" ON public.playwright_runs;
CREATE POLICY "Admin and staff can read playwright runs"
ON public.playwright_runs FOR SELECT TO authenticated
USING ((SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "Admin and staff can insert playwright runs" ON public.playwright_runs;
CREATE POLICY "Admin and staff can insert playwright runs"
ON public.playwright_runs FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_admin_or_staff()));

DROP POLICY IF EXISTS "Admin and staff can update playwright runs" ON public.playwright_runs;
CREATE POLICY "Admin and staff can update playwright runs"
ON public.playwright_runs FOR UPDATE TO authenticated
USING ((SELECT public.is_admin_or_staff()));
