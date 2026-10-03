-- RLS Policies: ai_workflow_definitions
-- Only admin/staff can read and modify workflow definitions

CREATE POLICY "admin_staff_select_workflows" ON public.ai_workflow_definitions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff'))
  );

CREATE POLICY "admin_staff_insert_workflows" ON public.ai_workflow_definitions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff'))
  );

CREATE POLICY "admin_staff_update_workflows" ON public.ai_workflow_definitions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff'))
  );

CREATE POLICY "admin_staff_delete_workflows" ON public.ai_workflow_definitions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'staff'))
  );
