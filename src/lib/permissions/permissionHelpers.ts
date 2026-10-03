/**
 * Pure permission helper functions
 *
 * These functions are extracted from usePermissions hook to enable
 * straightforward unit testing without mocking.
 *
 * @module
 */

/**
 * Permission codes used throughout the application.
 */
export type PermissionCode =
  // sensitive data Access
  | "view_sensitive_data"
  | "edit_sensitive_data"
  | "share_phi"
  // Member Features
  | "view_studies"
  | "enroll_studies"
  | "submit_checkins"
  | "upload_documents"
  // Shop Access
  | "view_products"
  | "preorder_products"
  | "order_products"
  | "auto_approve_orders"
  // Partner Features (shared)
  | "view_assigned_members"
  | "manage_member_assignments"
  | "view_partner_dashboard"
  | "schedule_appointments"
  | "send_member_messages"
  | "view_member_progress"
  // Partner Professional Features (production providers only)
  | "view_operational_details"
  | "create_operational_notes"
  | "issue_recommendations"
  | "access_lab_interpretations"
  | "prescribe_protocols"
  // Partner Amateur Features (non-production providers)
  | "view_basic_health_summary"
  | "create_wellness_notes"
  | "suggest_lifestyle_changes"
  // Evaluator Features
  | "evaluate_health_data"
  | "create_assessments"
  // Admin Features
  | "view_admin_dashboard"
  | "manage_users"
  | "manage_roles"
  | "manage_permissions"
  | "manage_studies"
  | "manage_products"
  | "manage_orders"
  | "view_audit_logs"
  | "manage_system_config"
  // Admin Tools Access (OAuth2 Proxy + Keycloak SSO)
  | "access_studio"
  | "access_n8n"
  // Staff Features
  | "view_staff_dashboard"
  | "process_orders"
  | "view_basic_reports"
  // Extensible - unknown permissions
  | (string & {});

/**
 * All application permissions (used for admin role).
 */
export const ALL_APP_PERMISSIONS: PermissionCode[] = [
  "view_sensitive_data",
  "edit_sensitive_data",
  "share_phi",
  "view_studies",
  "enroll_studies",
  "submit_checkins",
  "upload_documents",
  "view_products",
  "preorder_products",
  "order_products",
  "auto_approve_orders",
  "view_assigned_members",
  "manage_member_assignments",
  "view_partner_dashboard",
  "schedule_appointments",
  "send_member_messages",
  "view_member_progress",
  "view_operational_details",
  "create_operational_notes",
  "issue_recommendations",
  "access_lab_interpretations",
  "prescribe_protocols",
  "view_basic_health_summary",
  "create_wellness_notes",
  "suggest_lifestyle_changes",
  "evaluate_health_data",
  "create_assessments",
  "view_admin_dashboard",
  "manage_users",
  "manage_roles",
  "manage_permissions",
  "manage_studies",
  "manage_products",
  "manage_orders",
  "view_audit_logs",
  "manage_system_config",
  "access_studio",
  "access_n8n",
  "view_staff_dashboard",
  "process_orders",
  "view_basic_reports",
];

/**
 * Role to permissions mapping.
 * Used as fallback when DB permissions are unavailable.
 */
export const ROLE_TO_PERMISSIONS: Record<string, PermissionCode[]> = {
  admin: ALL_APP_PERMISSIONS,
  member: [
    "view_studies",
    "enroll_studies",
    "submit_checkins",
    "upload_documents",
    "view_products",
    "order_products",
  ],
  staff: ["view_staff_dashboard", "process_orders", "view_basic_reports", "manage_orders"],
  partner: [
    "view_partner_dashboard",
    "view_assigned_members",
    "view_member_progress",
    "schedule_appointments",
    "send_member_messages",
    "view_basic_health_summary",
    "create_wellness_notes",
    "suggest_lifestyle_changes",
  ],
  practitioner: [
    "view_partner_dashboard",
    "view_assigned_members",
    "view_member_progress",
    "schedule_appointments",
    "send_member_messages",
    "view_operational_details",
    "create_operational_notes",
    "access_lab_interpretations",
    "prescribe_protocols",
    "issue_recommendations",
  ],
  evaluator: ["evaluate_health_data", "create_assessments"],
};

/**
 * Remove duplicates from array.
 */
export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/**
 * Check if user has a specific permission.
 */
export function hasPermission(permissions: string[], code: PermissionCode): boolean {
  return permissions.includes(code);
}

/**
 * Check if user has ALL of the specified permissions.
 */
export function hasAllPermissions(permissions: string[], ...codes: PermissionCode[]): boolean {
  return codes.every((code) => permissions.includes(code));
}

/**
 * Check if user has ANY of the specified permissions.
 */
export function hasAnyPermission(permissions: string[], ...codes: PermissionCode[]): boolean {
  return codes.some((code) => permissions.includes(code));
}

/**
 * Derive permissions from user roles.
 * Used as fallback when DB permissions are unavailable.
 */
export function derivePermissionsFromRoles(
  roles: string[],
  isAdmin: boolean
): PermissionCode[] {
  if (isAdmin) return ALL_APP_PERMISSIONS;

  const derived: PermissionCode[] = [];
  for (const role of roles) {
    const perms = ROLE_TO_PERMISSIONS[role];
    if (perms) derived.push(...perms);
  }

  return uniq(derived);
}

/**
 * Parse RPC response to permission codes.
 * Handles multiple response formats for backward compatibility.
 */
export function parsePermissionsResponse(data: unknown): string[] {
  if (!data) return [];

  // Format 1: Array of objects with permission_code
  if (
    Array.isArray(data) &&
    data.every(
      (x): x is Record<string, unknown> =>
        x != null && typeof x === "object" && "permission_code" in x
    )
  ) {
    return uniq(
      (data as Array<{ permission_code: string }>).map((x) => x.permission_code)
    );
  }

  // Format 2: Array of strings
  if (Array.isArray(data) && data.every((x) => typeof x === "string")) {
    return uniq(data as string[]);
  }

  return [];
}
