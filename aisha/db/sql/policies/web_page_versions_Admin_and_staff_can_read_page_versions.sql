-- Policy: Admin and staff can read page versions ON public.web_page_versions
-- Auto-extracted (back-port reconciliation)

DROP POLICY IF EXISTS "Admin and staff can read page versions" ON public.web_page_versions;
CREATE POLICY "Admin and staff can read page versions" ON public.web_page_versions AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT is_admin_or_staff()));
