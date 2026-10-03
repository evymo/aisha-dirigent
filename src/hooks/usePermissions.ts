import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { safeWarn } from "@/lib/security/safeLogger";
import { z } from "zod";
import { userPermissionRowSchema } from "@/lib/validation/rpcSchemas";

/**
 * Permission codes used throughout the frontend.
 *
 * Source of truth:
 * - Backend permissions are stored in DB and exposed via `public.get_user_permissions()`.
 * - Frontend authorization should be permission-first (use permissions, not roles).
 * - Role-derived permissions below exist only as a fail-safe when the RPC is
 *   unavailable/misconfigured, to avoid accidental lockout.
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
 * Partner types based on is_production_provider flag
 */
export type PartnerType = "professional" | "amateur" | "uncertified";

export interface PermissionDetails {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  is_system: boolean;
}

export interface UsePermissionsReturn {
  /** All permission codes the current user has */
  permissions: string[];
  /** Check if user has a specific permission */
  hasPermission: (code: PermissionCode) => boolean;
  /** Check if user has ALL of the specified permissions */
  hasAllPermissions: (...codes: PermissionCode[]) => boolean;
  /** Check if user has ANY of the specified permissions */
  hasAnyPermission: (...codes: PermissionCode[]) => boolean;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

const ALL_APP_PERMISSIONS: PermissionCode[] = [
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
  "view_admin_panel",
  "manage_users",
  "manage_roles",
  "manage_permissions",
  "manage_studies",
  "manage_products",
  "manage_orders",
  "manage_ai_settings",
  "manage_agent_configurations",
  "view_audit_logs",
  "manage_system_config",
  "access_studio",
  "access_n8n",
  "view_staff_dashboard",
  "process_orders",
  "view_basic_reports",
];

const ROLE_TO_APP_PERMISSIONS: Record<string, PermissionCode[]> = {
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
  // Partner (amateur) - certified non-production partner with basic access
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
  // Practitioner (professional) - certified production provider with operational access
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

const uniq = <T,>(items: T[]) => Array.from(new Set(items));

/**
 * Hook to check user permissions.
 *
 * This hook provides methods to check if the current user has specific permissions.
 * Permissions are determined by the user's roles via the `app_role_permissions` table.
 *
 * @returns An object containing:
 * - `permissions`: Array of permission codes assigned to the user.
 * - `hasPermission`: Function to check a single permission.
 * - `hasAllPermissions`: Function to check if user has ALL listed permissions.
 * - `hasAnyPermission`: Function to check if user has ANY of the listed permissions.
 * - `isLoading`: Loading state.
 * - `error`: Error state.
 *
 * @example
 * ```tsx
 * const { hasPermission } = usePermissions();
 * if (hasPermission("view_sensitive_data")) {
 *   return <PhiData />;
 * }
 * ```
 */
export function usePermissions(): UsePermissionsReturn {
  const { user, roles, isAdmin, isLoading: sessionLoading } = useSession();

  const roleBasedPermissions = useMemo(() => {
    if (!user?.id) return [] as PermissionCode[];

    // Admin is a superset.
    if (isAdmin) return ALL_APP_PERMISSIONS;

    const derived: PermissionCode[] = [];
    for (const role of roles) {
      const perms = ROLE_TO_APP_PERMISSIONS[role];
      if (perms) derived.push(...perms);
    }

    return uniq(derived);
  }, [user?.id, roles, isAdmin]);

  const { data: permissions = [], isLoading, error } = useQuery({
    queryKey: ["user-permissions", user?.id, roles.join(","), isAdmin],
    queryFn: async () => {
      if (!user?.id) return [];

      try {
        const { data, error } = await aisha.rpc("get_user_permissions");
        if (error) throw new Error(error.message);

        // Validate with centralized schema
        const parsed = z.array(userPermissionRowSchema).safeParse(data);

        if (parsed.success) {
          // Permission-first: the DB returns canonical permission codes (permissions.code).
          // We intentionally do NOT merge role-derived fallbacks here to avoid UI privilege
          // escalation if the backend permission catalog is incomplete.
          const codes = parsed.data.map((x) => x.permission_code);
          return uniq(codes);
        }

        safeWarn("usePermissions.validation", "Unexpected RPC response format");
        return roleBasedPermissions;
      } catch (err: unknown) {
        // If RPC is missing/misconfigured, don't lock the user out.
        safeWarn("get_user_permissions not available; using role-based permissions", err instanceof Error ? err.message : "unknown");
        return roleBasedPermissions;
      }
    },
    enabled: !!user?.id && !sessionLoading,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const hasPermission = (code: PermissionCode): boolean => permissions.includes(code);
  const hasAllPermissions = (...codes: PermissionCode[]): boolean => codes.every((c) => permissions.includes(c));
  const hasAnyPermission = (...codes: PermissionCode[]): boolean => codes.some((c) => permissions.includes(c));

  return {
    permissions,
    hasPermission,
    hasAllPermissions,
    hasAnyPermission,
    isLoading,
    error: (error as Error | null) ?? null,
  };
}

/**
 * Hook for getting all permissions defined in the system.
 * Useful for admin UI to show permission management.
 */
/**
 * Hook for getting all permissions defined in the system.
 * Useful for admin UI to show permission management.
 *
 * @returns Query result containing the list of all permissions.
 */
export function useAllPermissions() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["all-permissions"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_permissions_catalog_admin");

      if (error) throw new Error(error.message);

      // Map RPC response to PermissionDetails interface
      // RPC returns: id, code, name, description, category, is_system, created_at, updated_at
      type RpcPermission = {
        id: string;
        code: string;
        name: string;
        description: string | null;
        category: string;
        is_system: boolean;
        created_at: string;
        updated_at: string;
      };
      const rawData = (data || []) as RpcPermission[];
      return rawData.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        category: p.category,
        is_system: p.is_system,
      })) as PermissionDetails[];
    },
    staleTime: 10 * 60 * 1000,
    enabled: isAdmin,
  });
}

/**
 * Hook for getting permissions assigned to a specific role.
 * Useful for admin UI to show/edit role permissions.
 */
/**
 * Hook for getting permissions assigned to a specific role.
 * Useful for admin UI to show/edit role permissions.
 *
 * @param role - The role to fetch permissions for.
 * @returns Query result containing the list of permissions assigned to the role.
 */
export function useRolePermissions(role: string | null) {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["role-permissions", role],
    queryFn: async () => {
      if (!role || !isAdmin) return [];

      const [{ data: permissions, error: permissionsError }, { data: mappings, error: mappingsError }] = await Promise.all([
        aisha.rpc("get_permissions_catalog_admin"),
        aisha.rpc("get_app_role_permissions_admin"),
      ]);

      if (permissionsError) throw permissionsError;
      if (mappingsError) throw mappingsError;

      // Map RPC response to PermissionDetails interface
      // RPC returns: id, code, name, description, category, is_system, created_at, updated_at
      type RpcPermission = {
        id: string;
        code: string;
        name: string;
        description: string | null;
        category: string;
        is_system: boolean;
        created_at: string;
        updated_at: string;
      };
      const rawPermissions = (permissions || []) as RpcPermission[];
      const allPermissions: PermissionDetails[] = rawPermissions.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        category: p.category,
        is_system: p.is_system,
      }));
      const byCode = new Map(allPermissions.map((p) => [p.code, p] as const));

      const roleMappings = ((mappings || []) as { role: string; permission_code: string }[]).filter((m) => m.role === role);

      return roleMappings
        .map((m) => byCode.get(m.permission_code))
        .filter((p): p is PermissionDetails => !!p);
    },
    enabled: !!role && isAdmin,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for checking a single permission.
 * Lighter weight than usePermissions when you only need one check.
 */
/**
 * Hook for checking a single permission.
 * Lighter weight than usePermissions when you only need one check.
 *
 * @param code - The permission code to check.
 * @returns Object containing the permission status, loading state, and error.
 */
export function useHasPermission(code: PermissionCode) {
  const { user } = useSession();

  const { data: hasPermission = false, isLoading, error } = useQuery({
    queryKey: ["has-permission", user?.id, code],
    queryFn: async () => {
      if (!user?.id) return false;

      const { data, error } = await aisha.rpc("has_permission", {
        p_permission_code: code
        ,
        p_user_id: user.id
      });

      if (error) throw new Error(error.message);
      return data as boolean;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  return { hasPermission, isLoading, error: error as Error | null };
}

// ============================================================================
// Admin Permission Management
// ============================================================================

export interface RolePermissionMapping {
  id: string;
  role: string;
  permission_code: string;
  permission_name: string;
  category: string;
  granted_at: string;
  granted_by: string | null;
}

/**
 * Hook for managing permissions in the admin interface.
 * Provides methods to list, grant, and revoke permissions for roles.
 *
 * @returns Object containing permission data and management functions.
 */
export function usePermissionManagement() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");
  const queryClient = useQueryClient();

  const { data: allPermissions = [], isLoading: permissionsLoading } = useQuery({
    queryKey: ["all-permissions-detailed"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_permissions_catalog_admin");

      if (error) throw new Error(error.message);

      // Map RPC response to PermissionDetails interface
      // RPC returns: id, code, name, description, category, created_at
      type RpcPermission = {
        id: string;
        code: string;
        name: string;
        description: string | null;
        category: string;
        created_at: string;
      };
      const rawData = (data || []) as RpcPermission[];
      return rawData.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        category: p.category,
        is_system: true,
      })) as PermissionDetails[];
    },
    staleTime: 5 * 60 * 1000,
    enabled: isAdmin,
  });

  const { data: rolePermissions = [], isLoading: mappingsLoading } = useQuery({
    queryKey: ["all-role-permissions"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_app_role_permissions_admin") as { data: unknown; error: Error | null };

      if (error) throw new Error(error.message);

      const mappings = (data || []) as {
        id: string;
        role: string;
        permission_code: string;
        granted_at: string;
        granted_by: string | null;
      }[];

      const byCode = new Map(allPermissions.map((p) => [p.code, p] as const));

      return mappings.map(
        (item): RolePermissionMapping => {
          const def = byCode.get(item.permission_code);
          return {
            id: item.id,
            role: item.role,
            permission_code: item.permission_code,
            permission_name: def?.name ?? item.permission_code,
            category: def?.category ?? "general",
            granted_at: item.granted_at,
            granted_by: item.granted_by,
          };
        }
      );
    },
    enabled: allPermissions.length > 0 && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const roleHasPermission = (role: string, permissionCode: string): boolean =>
    rolePermissions.some((rp) => rp.role === role && rp.permission_code === permissionCode);

  const getPermissionsForRole = (role: string): RolePermissionMapping[] =>
    rolePermissions.filter((rp) => rp.role === role);

  const togglePermission = async (role: string, permissionCode: string): Promise<{ error?: string }> => {
    if (!user || !isAdmin) return { error: "Unauthorized" };

    const hasIt = roleHasPermission(role, permissionCode);

    try {
      if (hasIt) {
        const { error } = await aisha.rpc("revoke_app_role_permission_admin", {
          p_permission_code: permissionCode
          ,
          p_role: role
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await aisha.rpc("grant_app_role_permission_admin", {
          p_permission_code: permissionCode
          ,
          p_role: role
        });
        if (error) throw new Error(error.message);
      }

      await queryClient.invalidateQueries({ queryKey: ["all-role-permissions"] });
      await queryClient.invalidateQueries({ queryKey: ["user-permissions"] });

      return {};
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update permission";
      return { error: message };
    }
  };

  return {
    allPermissions,
    rolePermissions,
    isLoading: permissionsLoading || mappingsLoading,
    roleHasPermission,
    getPermissionsForRole,
    togglePermission,
  };
}

/**
 * Hook to determine the partner type of the current user.
 *
 * @returns Object containing partner type information and helper booleans.
 */
export function usePartnerType() {
  const { user } = useSession();

  const { data: partnerType, isLoading, error } = useQuery({
    queryKey: ["partner-type", user?.id],
    queryFn: async (): Promise<PartnerType | null> => {
      if (!user?.id) return null;

      const { data, error } = await aisha.rpc("get_partner_type");

      if (error) {
        safeWarn("get_partner_type RPC not available", error.message);
        return null;
      }

      return data as PartnerType | null;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  return {
    partnerType,
    isProfessional: partnerType === "professional",
    isAmateur: partnerType === "amateur",
    isUncertified: partnerType === "uncertified",
    isPartner: partnerType !== null,
    isLoading,
    error: error as Error | null,
  };
}

/**
 * Hook to check if the current user is a professional partner.
 *
 * @returns Query result indicating if the user is a professional partner.
 */
export function useIsProfessionalPartner() {
  const { user } = useSession();

  return useQuery({
    queryKey: ["is-professional-partner", user?.id],
    queryFn: async (): Promise<boolean> => {
      if (!user?.id) return false;

      const { data, error } = await aisha.rpc("is_professional_partner");

      if (error) return false;
      return data === true;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
}
