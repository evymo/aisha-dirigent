import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  brandingProfileRpcResponseSchema,
  DEFAULT_BRANDING_PROFILE,
  type BrandingProfile,
  type BrandingProfileFormData,
} from "@/lib/schemas/brandingProfileSchemas";

/**
 * Fetch the resolved branding profile (partner override merged over global fallback).
 *
 * @param partnerId - Optional partner ID for white-label resolution. NULL = global.
 */
export function useBrandingProfile(partnerId?: string | null) {
  return useQuery({
    queryKey: ["branding-profile", partnerId ?? "global"],
    queryFn: async (): Promise<BrandingProfile | null> => {
      try {
        const { data, error } = await aisha.rpc("get_branding_profile", {
          p_partner_id: partnerId ?? undefined,
        });

        if (error) {
          safeError("brandingProfile.fetch", error);
          return null;
        }

        const parsed = brandingProfileRpcResponseSchema.safeParse(data);
        if (!parsed.success) {
          safeError("brandingProfile.parse", parsed.error);
          return null;
        }

        if (parsed.data.status === "not_found") {
          return null;
        }

        return parsed.data.profile;
      } catch (err) {
        safeError("brandingProfile.fetch", err);
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Mutation hook for admin branding profile upsert.
 * Supports both draft saves and publish actions.
 */
export function useUpdateBrandingProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      formData,
      publish,
    }: {
      formData: BrandingProfileFormData;
      publish: boolean;
    }): Promise<{ profileId: string; version: number }> => {
      const { data, error } = await aisha.rpc("set_branding_profile_admin", {
        p_color_accent: formData.color_accent,
        p_color_background: formData.color_background,
        p_color_destructive: formData.color_destructive,
        p_color_foreground: formData.color_foreground,
        p_color_muted: formData.color_muted,
        p_color_primary: formData.color_primary,
        p_color_secondary: formData.color_secondary,
        p_color_surface: formData.color_surface,
        p_dark_color_background: formData.dark_color_background ?? undefined,
        p_dark_color_foreground: formData.dark_color_foreground ?? undefined,
        p_dark_color_muted: formData.dark_color_muted ?? undefined,
        p_dark_color_primary: formData.dark_color_primary ?? undefined,
        p_dark_color_surface: formData.dark_color_surface ?? undefined,
        p_email_footer_text: formData.email_footer_text ?? undefined,
        p_email_header_bg: formData.email_header_bg ?? undefined,
        p_favicon_path: formData.favicon_path ?? undefined,
        p_font_faces: formData.font_faces ?? null,
        p_font_family_body: formData.font_family_body,
        p_font_family_brand: formData.font_family_brand,
        p_font_family_code: formData.font_family_code,
        p_login_accent_color: formData.login_accent_color ?? undefined,
        p_login_background_color: formData.login_background_color ?? undefined,
        p_login_card_bg: formData.login_card_bg ?? undefined,
        p_login_logo_path: formData.login_logo_path ?? undefined,
        p_logo_dark_path: formData.logo_dark_path ?? undefined,
        p_logo_path: formData.logo_path ?? undefined,
        p_operator_address: formData.operator_address ?? undefined,
        p_operator_email: formData.operator_email,
        p_operator_name: formData.operator_name,
        p_operator_phone: formData.operator_phone ?? undefined,
        p_operator_url: formData.operator_url || undefined,
        p_partner_id: formData.partner_id ?? undefined,
        p_publish: publish,
      });

      if (error) {
        safeError("brandingProfile.update", error as Error);
        throw new Error(error.message);
      }

      const result = data as { success: boolean; profile_id: string; profile_version: number };
      return { profileId: result.profile_id, version: result.profile_version };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["branding-profile", variables.formData.partner_id ?? "global"],
      });
      // Also invalidate global so any displayed resolved profile refreshes
      queryClient.invalidateQueries({ queryKey: ["branding-profile", "global"] });
    },
  });
}

/**
 * Re-export defaults and types for convenient single-source import.
 */
export { DEFAULT_BRANDING_PROFILE };
export type { BrandingProfile, BrandingProfileFormData };
