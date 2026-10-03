import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { aisha } from "@/integrations/db/client";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { useBrandingProfile } from "@/hooks/useBrandingProfile";

export const EMAIL_ASSETS_BUCKET = "email-assets";
export const DEFAULT_EMAIL_LOGO_PATH = "branding/logo.png";

const emailBrandingSchema = z.object({
  brand_name: z.string().min(1),
  support_email: z.string().email(),
  logo_path: z.string().min(1),
});

/**
 * Email branding configuration — bridge type matching legacy shape.
 */
export type EmailBrandingConfig = z.infer<typeof emailBrandingSchema>;

export const DEFAULT_EMAIL_BRANDING: EmailBrandingConfig = {
  brand_name: "Platform",
  support_email: "support@platform.com",
  logo_path: DEFAULT_EMAIL_LOGO_PATH,
};

/**
 * Get a public URL for an email branding asset.
 *
 * @param logoPath - Storage path inside the email-assets bucket.
 * @returns Public URL to the asset.
 */
export function getEmailBrandingLogoUrl(logoPath: string): string {
  const { data } = aisha.storage.from(EMAIL_ASSETS_BUCKET).getPublicUrl(logoPath);
  return data.publicUrl;
}

/**
 * Fetch email branding config — bridged from unified branding profile.
 *
 * Maps operator_name → brand_name, operator_email → support_email,
 * logo_path → logo_path from the resolved branding profile.
 */
export function useEmailBrandingConfig() {
  const { data: profile, isLoading, error } = useBrandingProfile();

  const branding = useMemo((): EmailBrandingConfig => {
    if (!profile) return DEFAULT_EMAIL_BRANDING;

    const logoPath = profile.logo_path ?? DEFAULT_EMAIL_LOGO_PATH;

    return {
      brand_name: profile.operator_name,
      support_email: profile.operator_email,
      logo_path: /\.[a-z]{2,4}$/i.test(logoPath) ? logoPath : `${logoPath}.png`,
    };
  }, [profile]);

  return {
    data: branding,
    isLoading,
    error,
    isError: !!error,
    isSuccess: !isLoading && !error,
  };
}

/**
 * Update email branding config via admin RPC.
 *
 * @deprecated Use useUpdateBrandingProfile directly for full profile control.
 * Retained for backward compatibility — writes to legacy system_config.
 */
export function useUpdateEmailBranding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: EmailBrandingConfig): Promise<void> => {
      const { error } = await aisha.rpc("set_system_config_admin", {
        p_category: "email",
        p_description: "Email branding used in auth templates",
        p_is_public: true,
        p_key: "email_branding",
        p_value: config,
      });

      if (error) {
        safeError("emailBranding.update", error as Error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-config", "email-branding"] });
    },
  });
}

const ALLOWED_EMAIL_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

const MAX_EMAIL_LOGO_BYTES = 2 * 1024 * 1024; // 2MB

// Removed MIME_TO_EXT — upload always goes to the fixed DEFAULT_EMAIL_LOGO_PATH
// so that the email template (which hardcodes the storage URL) always works.

/**
 * Result of a logo upload with both the storage path and a cache-busted public URL.
 */
export interface LogoUploadResult {
  /** Storage path inside the email-assets bucket (e.g. "branding/logo.jpg"). */
  storagePath: string;
  /** Public URL with cache-bust parameter for immediate display. */
  publicUrl: string;
}

/**
 * Upload and replace the email branding logo.
 *
 * Always uploads to the fixed DEFAULT_EMAIL_LOGO_PATH so the email template
 * (which hardcodes this storage path) always resolves correctly.
 * Content-Type header tells the browser how to decode the file, not the extension.
 */
export function useEmailBrandingUpload() {
  const uploadLogo = async (file: File): Promise<LogoUploadResult> => {
    if (!ALLOWED_EMAIL_LOGO_TYPES.has(file.type)) {
      safeWarn("email-branding.logo.invalidType", file.type);
      throw new Error("Unsupported logo file type");
    }

    if (file.size > MAX_EMAIL_LOGO_BYTES) {
      safeWarn("email-branding.logo.tooLarge", file.size);
      throw new Error("Logo file too large");
    }

    const { error: uploadError } = await aisha.storage
      .from(EMAIL_ASSETS_BUCKET)
      .upload(DEFAULT_EMAIL_LOGO_PATH, file, {
        cacheControl: "60",
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      safeError("email-branding.logo.upload", uploadError);
      throw uploadError;
    }

    // Append cache-bust param so browsers don't serve stale cached logo
    const baseUrl = getEmailBrandingLogoUrl(DEFAULT_EMAIL_LOGO_PATH);
    const publicUrl = `${baseUrl}?v=${Date.now()}`;

    return { storagePath: DEFAULT_EMAIL_LOGO_PATH, publicUrl };
  };

  return { uploadLogo };
}

/**
 * Build template data for auth emails (brand name, support email).
 *
 * Derives values from the unified branding profile.
 * Logo URL is NOT included here — it is baked directly into the email HTML
 * template at generation time.
 */
export function useAuthEmailTemplateData() {
  const { data: branding } = useEmailBrandingConfig();
  const config = branding ?? DEFAULT_EMAIL_BRANDING;

  return useMemo(
    () => ({
      brand_name: config.brand_name,
      support_email: config.support_email,
    }),
    [config.brand_name, config.support_email]
  );
}
