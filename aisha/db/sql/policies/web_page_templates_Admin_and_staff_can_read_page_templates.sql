-- Policy: Admin and staff can read page templates ON public.web_page_templates
-- Auto-extracted (back-port reconciliation)

DROP POLICY IF EXISTS "Admin and staff can read page templates" ON public.web_page_templates;
CREATE POLICY "Admin and staff can read page templates" ON public.web_page_templates AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT is_admin_or_staff()));
