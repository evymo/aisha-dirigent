import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { useSession } from './useSession';
import { safeError } from '@/lib/security/safeLogger';
import { rpcRoleDefinitionArraySchema, type RpcRoleDefinitionRow } from '@/lib/schemas/roleSchemas';

/**
 * Role definition from the role_definitions table
 * compliance/SOC 2 compliant role capabilities
 * 
 * Now directly mapped from DB - no frontend transformation needed
 */
export interface RoleDefinition {
  id: string;
  name: string;           // Maps from role_name in DB
  display_name: string;
  description: string | null;
  // Core flags (now from DB)
  is_admin: boolean;
  is_system: boolean;
  // Access capabilities (now from DB)
  can_manage_users: boolean;
  can_manage_roles: boolean;
  can_view_sensitive_data: boolean;
  // compliance-specific capabilities (now from DB)
  can_export_phi: boolean;      // compliance §164.312(e)(1) - Transmission Security
  can_break_glass: boolean;     // compliance §164.312(a)(1) - Emergency Access
  // Audit fields
  created_at: string;
  updated_at: string;
}

/**
 * Map RPC response to frontend RoleDefinition
 * Only transformation: role_name -> name
 */
function mapRpcToRoleDefinition(r: RpcRoleDefinitionRow): RoleDefinition {
  return {
    id: r.id,
    name: r.role_name,  // Only rename needed
    display_name: r.display_name,
    description: r.description,
    is_admin: r.is_admin,
    is_system: r.is_system,
    can_manage_users: r.can_manage_users,
    can_manage_roles: r.can_manage_roles,
    can_view_sensitive_data: r.can_view_sensitive_data,
    can_export_phi: r.can_export_phi,
    can_break_glass: r.can_break_glass,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}


/**
 * Hook for managing role definitions (admin-only)
 * 
 * This hook provides:
 * - List of all role definitions with their capabilities
 * - Functions to update role capabilities (non-system roles only)
 * - System role protection (cannot modify is_admin, is_system on system roles)
 * 
 * Security: System roles (admin, staff, practitioner, member) cannot be deleted
 * or have their core flags modified. This prevents privilege escalation attacks.
 */
export function useRoleDefinitions() {
  const { user, isAdmin } = useSession();
  const queryClient = useQueryClient();

  // Fetch all role definitions
  const { data: roles = [], isLoading, error, refetch } = useQuery({
    queryKey: ['role-definitions'],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_role_definitions");
      
      if (error) {
        safeError('useRoleDefinitions.fetch', error);
        throw new Error(error.message);
      }
      
      // Validate with Zod
      const parsed = rpcRoleDefinitionArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError('useRoleDefinitions.validation', parsed.error);
        return [];
      }
      return parsed.data.map(mapRpcToRoleDefinition);
    },
    enabled: !!user,
  });

  // Update role capabilities (admin only, non-system roles only)
  const updateRole = useMutation({
    mutationFn: async (params: {
      roleId: string;
      updates: Partial<Pick<RoleDefinition, 'display_name' | 'description' | 'can_manage_users' | 'can_manage_roles' | 'can_view_sensitive_data'>>;
    }) => {
      if (!isAdmin) {
        throw new Error('Only admins can update roles');
      }

      // RPC-only: use update_role_definition function
      const { data, error } = await aisha.rpc("update_role_definition", {
        p_can_manage_roles: params.updates.can_manage_roles ?? undefined,
        p_can_manage_users: params.updates.can_manage_users ?? undefined,
        p_can_view_phi: params.updates.can_view_sensitive_data ?? undefined
,
        p_description: params.updates.description ?? undefined,
        p_display_name: params.updates.display_name ?? undefined,
        p_role_id: params.roleId
    });

      if (error) {
        safeError('useRoleDefinitions.update', error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-definitions'] });
    },
  });

  // Get role by name
  const getRoleByName = (name: string): RoleDefinition | undefined => {
    return roles.find(r => r.name === name);
  };

  // Check if a role is system-protected
  const isSystemRole = (roleName: string): boolean => {
    const role = getRoleByName(roleName);
    return role?.is_system ?? false;
  };

  // Check if a role has admin privileges
  const isAdminRole = (roleName: string): boolean => {
    const role = getRoleByName(roleName);
    return role?.is_admin ?? false;
  };

  // Get roles with admin privileges
  const adminRoles = roles.filter(r => r.is_admin);
  
  // Get system-protected roles
  const systemRoles = roles.filter(r => r.is_system);

  return {
    roles,
    isLoading,
    error,
    refetch,
    updateRole: updateRole.mutateAsync,
    isUpdating: updateRole.isPending,
    getRoleByName,
    isSystemRole,
    isAdminRole,
    adminRoles,
    systemRoles,
  };
}

/**
 * Hook to get capabilities for the current user's roles
 * Returns aggregated compliance-compliant capability flags
 */
export function useUserRoleCapabilities() {
  const { user, roles: userRoles } = useSession();

  const { data: roleDefinitions = [] } = useQuery({
    queryKey: ['role-definitions'],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_role_definitions");
      
      if (error) {
        safeError('useUserRoleCapabilities.fetch', error);
        return [];
      }
      
      // Validate with Zod
      const parsed = rpcRoleDefinitionArraySchema.safeParse(data);
      if (!parsed.success) {
        safeError('useUserRoleCapabilities.validation', parsed.error);
        return [];
      }
      return parsed.data.map(mapRpcToRoleDefinition);
    },
    enabled: !!user,
  });

  // Aggregate capabilities from all user's roles
  const capabilities = {
    isAdmin: false,
    canManageUsers: false,
    canManageRoles: false,
    canViewPhi: false,
    canExportPhi: false,
    canBreakGlass: false,
  };

  for (const userRole of userRoles) {
    const roleDef = roleDefinitions.find(r => r.name === userRole);
    if (roleDef) {
      capabilities.isAdmin = capabilities.isAdmin || roleDef.is_admin;
      capabilities.canManageUsers = capabilities.canManageUsers || roleDef.can_manage_users;
      capabilities.canManageRoles = capabilities.canManageRoles || roleDef.can_manage_roles;
      capabilities.canViewPhi = capabilities.canViewPhi || roleDef.can_view_sensitive_data;
      capabilities.canExportPhi = capabilities.canExportPhi || roleDef.can_export_phi;
      capabilities.canBreakGlass = capabilities.canBreakGlass || roleDef.can_break_glass;
    }
  }

  return capabilities;
}
