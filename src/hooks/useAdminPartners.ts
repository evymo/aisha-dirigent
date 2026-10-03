import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";
import { usePermissions } from "./usePermissions";
import { useSession } from "./useSession";
import { useAdminGuard } from "@/hooks/useAdminGuard";

// Schema for partner profile from RPC
const partnerProfileAdminSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  display_name: z.string(),
  business_name: z.string().nullable(),
  city: z.string(),
  country: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  is_production_provider: z.boolean(),
  is_visible: z.boolean(),
  certification_level: z.string(),
  certification_score: z.number().nullable(),
  certification_passed_at: z.string().nullable(),
  created_at: z.string(),
  services: z.array(z.string()).nullable(),
});

export type PartnerProfileAdmin = z.infer<typeof partnerProfileAdminSchema>;

/**
 * Hook for fetching partner profiles with admin privileges
 */
export function usePartnerProfilesAdmin() {
  const { user } = useSession();
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-partners"],
    queryFn: async (): Promise<PartnerProfileAdmin[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_partner_profiles_admin");

      if (error) {
        safeError("admin.partners.fetchFailed", error);
        throw new Error(error.message);
      }

      const parsed = z.array(partnerProfileAdminSchema).safeParse(data);
      return parsed.success ? parsed.data : [];
    },
    enabled: isAdmin && !!user,
  });
}

/**
 * Hook for toggling partner visibility
 */
export function useTogglePartnerVisibility() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("set_partner_profile_visibility_admin", async ({ partnerId, isVisible }: { partnerId: string; isVisible: boolean }) => {
      const { error } = await aisha.rpc("set_partner_profile_visibility_admin", {
        p_is_visible: isVisible
,
        p_partner_profile_id: partnerId
    });

      if (error) throw new Error(error.message);
      return { partnerId, isVisible };
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-partners"] });
    },
    onError: (error) => {
      safeError("admin.partners.visibilityFailed", error);
    },
  });
}

/**
 * Hook for revoking partner certification
 */
export function useRevokePartnerCertification() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("revoke_partner_certification_admin", async (partnerId: string) => {
      const { error } = await aisha.rpc("revoke_partner_certification_admin", {
        p_partner_profile_id: partnerId,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-partners"] });
    },
    onError: (error) => {
      safeError("admin.partners.revokeFailed", error);
    },
  });
}

/**
 * Hook for deleting partner profile
 */
export function useDeletePartnerProfile() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_partner_profile_admin", async (partnerId: string) => {
      const { error } = await aisha.rpc("delete_partner_profile_admin", {
        p_partner_profile_id: partnerId,
      });

      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-partners"] });
    },
    onError: (error) => {
      safeError("admin.partners.deleteFailed", error);
    },
  });
}
