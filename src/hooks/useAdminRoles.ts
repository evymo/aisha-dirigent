import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { parseArrayResponse, userRoleAdminArraySchema, type UserRoleAdminRow, type AppRole } from "@/lib/schemas/adminSchemas";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

export interface UserRoleWithProfile {
  id: string;
  user_id: string;
  role: AppRole;
  granted_at: string;
  granted_by: string | null;
  profile?: {
    email: string | null;
    display_name: string | null;
  };
}

/**
 * Hook for fetching all user roles (admin only)
 */
export function useUserRolesAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async (): Promise<UserRoleWithProfile[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_user_roles_admin");
      if (error) throw new Error(error.message);

      const validatedData = parseArrayResponse(userRoleAdminArraySchema, data, "userRoles");
      
      return validatedData.map((r: UserRoleAdminRow) => ({
        id: r.id,
        user_id: r.user_id,
        role: r.role,
        granted_at: r.granted_at,
        granted_by: r.granted_by,
        profile: {
          email: r.profile_email ?? null,
          display_name: r.profile_display_name ?? null,
        },
      }));
    },
    staleTime: 2 * 60 * 1000,
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for granting a role to a user
 */
export function useGrantUserRole() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("grant_user_role_admin", async (params: { email: string; role: AppRole }) => {
      const { error } = await aisha.rpc("grant_user_role_admin", {
        p_email: params.email.trim().toLowerCase(),
        p_role: params.role,
      });

      if (error) {
        const msg = error.message || "";
        if (msg.includes("USER_NOT_FOUND")) {
          throw new Error("USER_NOT_FOUND");
        }
        if (msg.includes("ROLE_EXISTS")) {
          throw new Error("ROLE_EXISTS");
        }
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
    },
    onError: (error) => {
      safeError("adminRoles.grant.failed", error);
    },
  });
}

/**
 * Hook for revoking a user's role
 */
export function useRevokeUserRole() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("revoke_user_role_admin", async (roleId: string) => {
      const { error } = await aisha.rpc("revoke_user_role_admin", {
        p_role_id: roleId,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
    },
    onError: (error) => {
      safeError("adminRoles.revoke.failed", error);
    },
  });
}
