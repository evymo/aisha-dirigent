-- STEP 1: System Roles with Capabilities
-- ============================================================================

-- Ensure canonical i18n keys exist for questionnaires (backfill for older rows)
UPDATE public.questionnaires
SET
  name_key = COALESCE(name_key, code || '.name'),
  description_key = COALESCE(description_key, code || '.description')
WHERE code IS NOT NULL;

-- Seed dynamic translations for questionnaires (namespace: questionnaires)
-- Idempotent + non-destructive: do NOT overwrite existing translation rows.
INSERT INTO public.translations (locale, namespace, key, value, created_at, updated_at)
SELECT sl.code, 'questionnaires', q.name_key, q.name, NOW(), NOW()
FROM public.questionnaires q
JOIN public.supported_languages sl ON sl.is_active = true
WHERE q.name_key IS NOT NULL
  AND q.name IS NOT NULL
  AND q.name != ''
ON CONFLICT (locale, namespace, key) DO NOTHING;

-- Note: questionnaire description translations are seeded in translations/06_questionnaires.sql
-- (questionnaires table no longer has a 'description' column, only 'description_key')

INSERT INTO public.roles (name, display_name, description, is_admin, is_system, can_manage_users, can_manage_roles, can_view_phi, can_export_phi, can_break_glass) VALUES
  ('admin', 'Administrator', 'Full system access with all privileges', true, true, true, true, true, true, true),
  ('staff', 'Staff Member', 'Internal team member with elevated access', true, true, true, false, true, false, false),
  ('practitioner', 'Practitioner', 'Production practitioner with operational access', false, true, false, false, true, false, false),
  ('partner', 'Partner', 'Certified non-production partner (community coach, advisor)', false, true, false, false, false, false, false),
  ('member', 'Member', 'Standard platform member', false, true, false, false, false, false, false),
  ('evaluator', 'Evaluator', 'Study evaluator with access to blinded data', false, true, false, false, true, true, false)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  can_manage_users = EXCLUDED.can_manage_users,
  can_manage_roles = EXCLUDED.can_manage_roles,
  can_view_phi = EXCLUDED.can_view_phi,
  can_export_phi = EXCLUDED.can_export_phi,
  can_break_glass = EXCLUDED.can_break_glass,
  updated_at = NOW();
  -- Note: is_admin and is_system are NOT updated on conflict (protection against escalation)

-- ============================================================================
-- STEP 2: Role-Section-Permission Assignments
-- ============================================================================

-- Admin: Full access to ALL sections (read + write)
INSERT INTO public.role_permissions (role, section, permission)
SELECT 'admin'::public.app_role, s.section, p.permission
FROM unnest(ARRAY['overview', 'members', 'roles', 'consultants', 'partners', 'studies', 
  'registrations', 'contributions', 'outcomes', 'archive', 'products', 'production', 
  'test_questions', 'questionnaires', 'translations', 'biomarker_ranges', 'orders', 
  'subscriptions', 'packages', 'tokenomics']::public.admin_section[]) AS s(section),
  unnest(ARRAY['read', 'write']::public.permission_type[]) AS p(permission)
ON CONFLICT (role, section, permission) DO NOTHING;

-- Staff, Practitioner, Member, Evaluator: role-specific section permissions
INSERT INTO public.role_permissions (role, section, permission) VALUES
  -- Staff: Read + Write sections
  ('staff', 'overview', 'read'), ('staff', 'overview', 'write'),
  ('staff', 'members', 'read'), ('staff', 'members', 'write'),
  ('staff', 'studies', 'read'), ('staff', 'studies', 'write'),
  ('staff', 'registrations', 'read'), ('staff', 'registrations', 'write'),
  ('staff', 'archive', 'read'), ('staff', 'archive', 'write'),
  ('staff', 'products', 'read'), ('staff', 'products', 'write'),
  ('staff', 'orders', 'read'), ('staff', 'orders', 'write'),
  -- Staff: Read-only sections
  ('staff', 'contributions', 'read'),
  ('staff', 'outcomes', 'read'),
  ('staff', 'subscriptions', 'read'),
  ('staff', 'consultants', 'read'),
  ('staff', 'partners', 'read'),
  -- Practitioner: Read access to user-related sections
  ('practitioner', 'overview', 'read'),
  ('practitioner', 'studies', 'read'),
  ('practitioner', 'registrations', 'read'),
  ('practitioner', 'outcomes', 'read'),
  ('practitioner', 'products', 'read'),
  ('practitioner', 'archive', 'read'),
  -- Member: Basic read access
  ('member', 'products', 'read'),
  ('member', 'studies', 'read'),
  ('member', 'archive', 'read'),
  -- Evaluator: Research data access for study evaluation
  ('evaluator', 'studies', 'read'),
  ('evaluator', 'registrations', 'read'),
  ('evaluator', 'outcomes', 'read'),
  ('evaluator', 'contributions', 'read')
ON CONFLICT (role, section, permission) DO NOTHING;

-- ============================================================================
-- STEP 2.5: Permissions Catalog
-- ============================================================================
-- All application permissions used by hasPermission() checks

INSERT INTO public.permissions (code, name, description, category, is_system)
VALUES
  -- Admin permissions
  ('view_admin_dashboard', 'View Admin Dashboard', 'Can view admin dashboard', 'admin', true),
  ('manage_users', 'Manage Users', 'Can manage users', 'admin', true),
  ('manage_roles', 'Manage Roles', 'Can manage roles', 'admin', true),
  ('manage_permissions', 'Manage Permissions', 'Can manage permissions', 'admin', true),
  ('manage_studies', 'Manage Studies', 'Can manage studies', 'admin', true),
  ('manage_products', 'Manage Products', 'Can manage products', 'admin', true),
  ('manage_orders', 'Manage Orders', 'Can manage orders', 'admin', true),
  ('view_audit_logs', 'View Audit Logs', 'Can view audit logs', 'admin', true),
  ('manage_system_config', 'Manage System Config', 'Can manage system configuration', 'admin', true),
  ('manage_agent_configurations', 'Manage AI Agent Configurations', 'Create, edit and delete AI agent configurations', 'admin', false),
  ('manage_ai_settings', 'Manage AI Settings', 'Can manage AI proactive triggers, scheduled jobs and monitoring', 'admin', false),
  ('view_admin_panel', 'View Admin Panel', 'Can view AI evaluation, tasks and user memory admin panels', 'admin', false),
  -- Staff permissions
  ('view_staff_dashboard', 'View Staff Dashboard', 'Can view staff dashboard', 'staff', true),
  ('process_orders', 'Process Orders', 'Can process orders', 'staff', true),
  ('view_basic_reports', 'View Basic Reports', 'Can view basic reports', 'staff', true),
  -- Member permissions
  ('view_studies', 'View Studies', 'Can view available studies', 'member', true),
  ('enroll_studies', 'Enroll in Studies', 'Can enroll in studies', 'member', true),
  ('submit_checkins', 'Submit Check-ins', 'Can submit daily check-ins', 'member', true),
  ('upload_documents', 'Upload Documents', 'Can upload documents', 'member', true),
  -- Shop permissions
  ('view_products', 'View Products', 'Can view products', 'shop', true),
  ('preorder_products', 'Preorder Products', 'Can preorder products', 'shop', true),
  ('order_products', 'Order Products', 'Can order products', 'shop', true),
  ('auto_approve_orders', 'Auto Approve Orders', 'Orders are auto-approved', 'shop', true),
  -- sensitive data permissions
  ('view_phi', 'View sensitive data', 'Can view protected sensitive information', 'phi', true),
  ('edit_phi', 'Edit sensitive data', 'Can edit protected sensitive information', 'phi', true),
  ('share_phi', 'Share sensitive data', 'Can share protected sensitive information', 'phi', true),
  -- Partner permissions (shared)
  ('view_partner_dashboard', 'View Partner Dashboard', 'Can view partner dashboard', 'partner', true),
  ('view_assigned_members', 'View Assigned Members', 'Can view assigned members', 'partner', true),
  ('manage_member_assignments', 'Manage Member Assignments', 'Can manage member assignments', 'partner', true),
  ('schedule_appointments', 'Schedule Appointments', 'Can schedule appointments', 'partner', true),
  ('send_member_messages', 'Send Member Messages', 'Can send messages to members', 'partner', true),
  ('view_member_progress', 'View Member Progress', 'Can view member progress', 'partner', true),
  -- Partner Professional (production providers)
  ('view_operational_details', 'View Operational Details', 'Can view operational details', 'partner_pro', true),
  ('create_operational_notes', 'Create Operational Notes', 'Can create operational notes', 'partner_pro', true),
  ('issue_recommendations', 'Issue Recommendations', 'Can issue recommendations', 'partner_pro', true),
  ('access_lab_interpretations', 'Access Lab Interpretations', 'Can access lab interpretations', 'partner_pro', true),
  ('prescribe_protocols', 'Prescribe Protocols', 'Can prescribe protocols', 'partner_pro', true),
  -- Partner Amateur (non-production)
  ('view_basic_health_summary', 'View Basic Summary', 'Can view basic summary', 'partner_amateur', true),
  ('create_community_notes', 'Create Community Notes', 'Can create community notes', 'partner_amateur', true),
  ('suggest_lifestyle_changes', 'Suggest Lifestyle Changes', 'Can suggest lifestyle changes', 'partner_amateur', true),
  -- Evaluator permissions
  ('evaluate_health_data', 'Evaluate Data', 'Can evaluate data', 'evaluator', true),
  ('create_assessments', 'Create Assessments', 'Can create assessments', 'evaluator', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_system = EXCLUDED.is_system;

-- ============================================================================
-- STEP 2.6: App Role Permissions (role → permission mappings)
-- ============================================================================
-- Grant permissions to roles via app_role_permissions table

-- Admin: All permissions
INSERT INTO public.app_role_permissions (role, permission_id, granted_by)
SELECT 'admin'::public.app_role, p.id, '00000000-0000-0000-0000-000000000001'
FROM public.permissions p
ON CONFLICT (role, permission_id) DO NOTHING;

-- Staff, Member, Partner, Practitioner, Evaluator: role-specific permission grants
INSERT INTO public.app_role_permissions (role, permission_id, granted_by)
SELECT r.role, p.id, '00000000-0000-0000-0000-000000000001'
FROM public.permissions p
JOIN (VALUES
  -- Staff: Staff + limited admin
  ('staff'::public.app_role, 'view_staff_dashboard'),
  ('staff', 'process_orders'),
  ('staff', 'view_basic_reports'),
  ('staff', 'manage_orders'),
  ('staff', 'view_products'),
  ('staff', 'view_studies'),
  -- Member: Member permissions
  ('member', 'view_studies'),
  ('member', 'enroll_studies'),
  ('member', 'submit_checkins'),
  ('member', 'upload_documents'),
  ('member', 'view_products'),
  ('member', 'order_products'),
  -- Partner: Amateur/non-production partner permissions
  ('partner', 'view_partner_dashboard'),
  ('partner', 'view_assigned_members'),
  ('partner', 'view_member_progress'),
  ('partner', 'schedule_appointments'),
  ('partner', 'send_member_messages'),
  ('partner', 'view_basic_health_summary'),
  ('partner', 'create_community_notes'),
  ('partner', 'suggest_lifestyle_changes'),
  -- Practitioner: Professional partner permissions (production providers)
  ('practitioner', 'view_partner_dashboard'),
  ('practitioner', 'view_assigned_members'),
  ('practitioner', 'manage_member_assignments'),
  ('practitioner', 'schedule_appointments'),
  ('practitioner', 'send_member_messages'),
  ('practitioner', 'view_member_progress'),
  ('practitioner', 'view_operational_details'),
  ('practitioner', 'create_operational_notes'),
  ('practitioner', 'issue_recommendations'),
  ('practitioner', 'access_lab_interpretations'),
  ('practitioner', 'prescribe_protocols'),
  -- Evaluator: Evaluator permissions
  ('evaluator', 'evaluate_health_data'),
  ('evaluator', 'create_assessments')
) AS r(role, code) ON p.code = r.code
ON CONFLICT (role, permission_id) DO NOTHING;

-- ============================================================================
