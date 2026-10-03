import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { aisha } from "@/integrations/db/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useSession } from "@/hooks/useSession";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";

// ============================================
// ZOD SCHEMAS FOR TYPE-SAFE RPC VALIDATION
// ============================================

export const InvitationClaimSchema = z.object({
  claim_id: z.string().uuid(),
  user_id: z.string().uuid(),
  claimed_at: z.string(),
  user_name: z.string(),
});

const InvitationBaseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  study_id: z.string().uuid().nullable(),
  role: z.string().nullable(),
  email: z.string().email().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  max_uses: z.number().int().nullable(),
  used_count: z.number().int(),
  is_active: z.boolean(),
  prefill_first_name: z.string().nullable(),
  prefill_last_name: z.string().nullable(),
  prefill_phone: z.string().nullable(),
  prefill_notes: z.string().nullable(),
  study_name: z.string().nullable(),
});

const RpcInvitationAdminSchema = InvitationBaseSchema.extend({
  claims: z.array(InvitationClaimSchema).nullable().optional(),
});

export const ValidateInvitationResponseSchema = z.object({
  is_valid: z.boolean(),
  study_name: z.string().nullable().optional(),
  study_id: z.string().uuid().nullable().optional(),
  parent_study_id: z.string().uuid().nullable().optional(),
  parent_study_name: z.string().nullable().optional(),
  partner_name: z.string().nullable().optional(),
  partner_id: z.string().uuid().nullable().optional(),
  invited_email: z.string().nullable().optional(),
  prefill_first_name: z.string().nullable().optional(),
  prefill_last_name: z.string().nullable().optional(),
  prefill_phone: z.string().nullable().optional(),
  prefill_notes: z.string().nullable().optional(),
});

// ============================================
// EXPORTED TYPES (inferred from Zod schemas)
// ============================================

export type InvitationClaim = z.infer<typeof InvitationClaimSchema>;
export type ValidateInvitationResponse = z.infer<typeof ValidateInvitationResponseSchema>;

export interface Invitation {
  id: string;
  code: string;
  study_id: string | null;
  role: string | null;
  email: string | null;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  prefill_first_name?: string | null;
  prefill_last_name?: string | null;
  prefill_phone?: string | null;
  prefill_notes?: string | null;
  study?: {
    name: string;
  };
  claims?: InvitationClaim[];
}

export type CreateInvitationInput = {
  code?: string;
  study_id?: string | null;
  role?: string | null;
  max_uses?: number | null;
  expires_at?: string | null;
  email?: string | null;
  prefill_first_name?: string | null;
  prefill_last_name?: string | null;
  prefill_phone?: string | null;
  prefill_notes?: string | null;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

const isPermissionDenied = (err: unknown) => {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { code?: string; status?: number; message?: string };
  return (
    maybe.status === 401 ||
    maybe.status === 403 ||
    maybe.code === "42501" ||
    (typeof maybe.message === "string" && maybe.message.toLowerCase().includes("permission"))
  );
};

/**
 * Safely parse RPC array response with Zod schema
 */
function parseRpcInvitationArray<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string
): T[] {
  if (!Array.isArray(data)) {
    safeWarn(`${context}.parse`, "Expected array, got non-array");
    return [];
  }
  
  const results: T[] = [];
  for (const item of data) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      results.push(parsed.data);
    } else {
      safeWarn(`${context}.parse`, "Schema validation failed for item");
    }
  }
  return results;
}

/**
 * Hook for managing invitations (admin/partner).
 * All DB access via RPC for centralized audit logging.
 *
 * @returns Object containing invitations list, loading state, and mutation functions.
 */
export function useInvitations() {
  const queryClient = useQueryClient();
  const { user, isLoading: sessionLoading } = useSession();
  const { hasAnyPermission, hasPermission, isLoading: permissionsLoading } = usePermissions();

  const canUseAdminInvitations = hasAnyPermission("view_admin_dashboard", "view_staff_dashboard") && hasPermission("manage_users");
  const canUsePartnerInvitations = hasAnyPermission("view_partner_dashboard");
  const enabled = !!user?.id && !sessionLoading && !permissionsLoading && (canUseAdminInvitations || canUsePartnerInvitations);

  const { data: invitations, isLoading } = useQuery({
    queryKey: ["invitations"],
    queryFn: async (): Promise<Invitation[]> => {
      if (!enabled) return [];

      const rpcName = canUseAdminInvitations ? "get_invitations_admin" : "get_invitations";
      const { data, error } = await aisha.rpc(rpcName);

      if (error) {
        safeError("Invitations.fetch", error);

        // Avoid noisy console/network spam when a user doesn't have access.
        if (isPermissionDenied(error)) {
          return [];
        }

        throw new Error(getUserFacingDataErrorMessage(error));
      }

      if (!Array.isArray(data)) return [];

      if (canUseAdminInvitations) {
        const validated = parseRpcInvitationArray(RpcInvitationAdminSchema, data, "Invitations.admin");
        return validated.map((inv) => ({
          id: inv.id,
          code: inv.code,
          study_id: inv.study_id,
          role: inv.role,
          email: inv.email,
          created_by: inv.created_by,
          created_at: inv.created_at,
          expires_at: inv.expires_at,
          max_uses: inv.max_uses,
          used_count: inv.used_count,
          is_active: inv.is_active,
          prefill_first_name: inv.prefill_first_name,
          prefill_last_name: inv.prefill_last_name,
          prefill_phone: inv.prefill_phone,
          prefill_notes: inv.prefill_notes,
          study: inv.study_name ? { name: inv.study_name } : undefined,
          claims: inv.claims || [],
        }));
      }

      const validated = parseRpcInvitationArray(InvitationBaseSchema, data, "Invitations.partner");
      return validated.map((inv) => ({
        id: inv.id,
        code: inv.code,
        study_id: inv.study_id,
        role: inv.role,
        email: inv.email,
        created_by: inv.created_by,
        created_at: inv.created_at,
        expires_at: inv.expires_at,
        max_uses: inv.max_uses,
        used_count: inv.used_count,
        is_active: inv.is_active,
        prefill_first_name: inv.prefill_first_name,
        prefill_last_name: inv.prefill_last_name,
        prefill_phone: inv.prefill_phone,
        prefill_notes: inv.prefill_notes,
        study: inv.study_name ? { name: inv.study_name } : undefined,
        claims: [],
      }));
    },
    enabled,
  });

  const createInvitation = useMutation({
    mutationFn: async (newInvitation: CreateInvitationInput) => {
      if (!enabled) {
        throw new Error(getUserFacingDataErrorMessage({ message: "Not authorized" }));
      }

      const { data, error } = await aisha.rpc("create_invitation", {
        p_code: newInvitation.code ?? undefined,
        p_email: newInvitation.email ?? undefined,
        p_expires_at: newInvitation.expires_at ?? undefined,
        p_max_uses: newInvitation.max_uses ?? undefined,
        p_prefill_first_name: newInvitation.prefill_first_name ?? undefined,
        p_prefill_last_name: newInvitation.prefill_last_name ?? undefined,
        p_prefill_notes: newInvitation.prefill_notes ?? undefined
,
        p_prefill_phone: newInvitation.prefill_phone ?? undefined,
        p_role: newInvitation.role ?? undefined,
        p_study_id: newInvitation.study_id ?? undefined
    });

      if (error) {
        safeError("Invitations.create", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
  });

  const toggleInvitation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!enabled) {
        throw new Error(getUserFacingDataErrorMessage({ message: "Not authorized" }));
      }

      const { error } = await aisha.rpc("toggle_invitation", {
        p_invitation_id: id,
        p_is_active: is_active,
      });

      if (error) {
        safeError("Invitations.toggle", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
  });

  return {
    invitations,
    isLoading,
    createInvitation,
    toggleInvitation,
  };
}

/**
 * Hook to validate an invitation code.
 * Returns validation result including study info and prefill data.
 *
 * @param code - The invitation code to validate
 * @returns Query result with validation data
 *
 * @example
 * const { data, isLoading, error } = useValidateInvitation(inviteCode);
 * if (data?.is_valid) { // Invitation is valid }
 */
export function useValidateInvitation(code: string | undefined | null) {
  return useQuery({
    queryKey: ["validate-invitation", code],
    queryFn: async (): Promise<ValidateInvitationResponse | null> => {
      if (!code) return null;

      const { data, error } = await aisha.rpc("validate_invitation", {
        p_invite_code: code,
      });

      if (error) {
        safeError("useValidateInvitation.error", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }

      const rawResult = Array.isArray(data) ? data[0] : data;
      const parsed = ValidateInvitationResponseSchema.safeParse(rawResult);

      if (!parsed.success) {
        safeWarn("useValidateInvitation.parse", "Schema validation failed");
        return null;
      }

      return parsed.data;
    },
    enabled: !!code,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to claim an invitation for the current user.
 *
 * @returns Mutation for claiming invitations
 *
 * @example
 * const { mutateAsync: claimInvitation, isPending } = useClaimInvitation();
 * await claimInvitation({ code: 'ABC123' });
 */
export function useClaimInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ code }: { code: string }) => {
      const { error } = await aisha.rpc("claim_invitation", {
        p_code: code,
      });

      if (error) {
        safeError("useClaimInvitation.error", error);
        throw new Error(getUserFacingDataErrorMessage(error));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      queryClient.invalidateQueries({ queryKey: ["validate-invitation"] });
    },
  });
}
