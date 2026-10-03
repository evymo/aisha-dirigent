-- Policy: Admin and staff can manage page templates ON public.web_page_templates
-- Auto-extracted (back-port reconciliation)

DROP POLICY IF EXISTS "Admin and staff can manage page templates" ON public.web_page_templates;
CREATE POLICY "Admin and staff can manage page templates" ON public.web_page_templates AS PERMISSIVE FOR ALL TO authenticated USING ((SELECT is_admin_or_staff())) WITH CHECK ((SELECT is_admin_or_staff()));
