import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { safeError, safeWarn } from "@/lib/security/safeLogger";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { HeroSlideAdminSchema, parseRpcArrayResponse } from "@/schemas/rpcResponseSchemas";
import type { HeroSlideAdmin } from "@/schemas/rpcResponseSchemas";

export type { HeroSlideAdmin };

const MAX_HERO_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_HERO_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export interface HeroSlidePayload {
  id?: string;
  base_locale?: string;
  title_key?: string;
  subtitle_key?: string;
  badge_key?: string;
  cta_text_key?: string;
  circle_icon_key?: string;
  circle_text_key?: string;
  target_audience?: string;
  background_image_url?: string;
  background_gradient?: string;
  cta_url?: string;
  linked_product_id?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

export function useAdminHeroSlides() {
  const { user, isLoading: sessionLoading } = useSession();
  const { hasPermission } = usePermissions();
  const { guardAdminMutation } = useAdminGuard();
  const isAdmin = hasPermission("view_admin_dashboard");
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ["admin-hero-slides"],
    queryFn: async (): Promise<HeroSlideAdmin[]> => {
      if (!isAdmin || !user) return [];
      const { data, error } = await aisha.rpc("get_hero_slides_admin");
      
      if (error) {
        safeError("admin-hero-slides.fetch", error);
        throw new Error(error.message);
      }

      // Validate response with Zod schema
      return parseRpcArrayResponse(HeroSlideAdminSchema, data);
    },
    enabled: !!user && !sessionLoading && isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: guardAdminMutation("create_hero_slide_admin", async (data: HeroSlidePayload) => {
      const { data: id, error } = await aisha.rpc("create_hero_slide_admin", {
        p_background_gradient: data.background_gradient || undefined,
        p_background_image_url: data.background_image_url || undefined,
        p_badge_key: data.badge_key ?? undefined,
        p_base_locale: data.base_locale ?? undefined,
        p_circle_icon_key: data.circle_icon_key ?? undefined,
        p_circle_text_key: data.circle_text_key ?? undefined,
        p_cta_text_key: data.cta_text_key ?? undefined,
        p_cta_url: data.cta_url || undefined,
        p_id: data.id ?? undefined,
        p_is_active: data.is_active ?? true,
        p_linked_product_id: data.linked_product_id || undefined,
        p_sort_order: data.sort_order ?? 0
,
        p_subtitle_key: data.subtitle_key ?? undefined,
        p_target_audience: data.target_audience || "all",
        p_title_key: data.title_key ?? undefined
    });

      if (error) {
        safeError("admin-hero-slides.create", error);
        throw new Error(error.message);
      }

      return id;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-hero-slides"] });
      queryClient.invalidateQueries({ queryKey: ["hero-slides"] });
      toast.success(t("admin.heroSlides.created"));
    },
    onError: () => {
      toast.error(t("admin.heroSlides.errors.createFailed"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: guardAdminMutation("update_hero_slide_admin", async ({ id, data }: { id: string; data: Partial<HeroSlidePayload> }) => {
      const { error } = await aisha.rpc("update_hero_slide_admin", {
        p_background_gradient: data.background_gradient || undefined,
        p_background_image_url: data.background_image_url || undefined,
        p_badge_key: data.badge_key ?? undefined,
        p_base_locale: data.base_locale ?? undefined,
        p_circle_icon_key: data.circle_icon_key ?? undefined,
        p_circle_text_key: data.circle_text_key ?? undefined,
        p_cta_text_key: data.cta_text_key ?? undefined,
        p_cta_url: data.cta_url || undefined,
        p_id: id,
        p_is_active: data.is_active,
        p_linked_product_id: data.linked_product_id || undefined,
        p_sort_order: data.sort_order ?? 0,
        p_subtitle_key: data.subtitle_key ?? undefined,
        p_target_audience: data.target_audience || undefined,
        p_title_key: data.title_key ?? undefined
    });

      if (error) {
        safeError("admin-hero-slides.update", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-hero-slides"] });
      queryClient.invalidateQueries({ queryKey: ["hero-slides"] });
      toast.success(t("admin.heroSlides.updated"));
    },
    onError: () => {
      toast.error(t("admin.heroSlides.errors.updateFailed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: guardAdminMutation("delete_hero_slide_admin", async (id: string) => {
      const { error } = await aisha.rpc("delete_hero_slide_admin", { p_id: id });

      if (error) {
        safeError("admin-hero-slides.delete", error);
        throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-hero-slides"] });
      queryClient.invalidateQueries({ queryKey: ["hero-slides"] });
      toast.success(t("admin.heroSlides.deleted"));
    },
    onError: () => {
      toast.error(t("admin.heroSlides.errors.deleteFailed"));
    },
  });

  return {
    slides: query.data,
    isLoading: query.isLoading || sessionLoading,
    createSlide: createMutation.mutate,
    updateSlide: updateMutation.mutate,
    deleteSlide: deleteMutation.mutate,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

// Hook for uploading hero images
export function useHeroImageUpload() {
  const { t } = useTranslation();

  const uploadImage = async (file: File): Promise<string> => {
    if (!ALLOWED_HERO_IMAGE_TYPES.has(file.type)) {
      safeWarn("hero-image.invalidType", file.type);
      toast.error(t("admin.heroSlides.errors.uploadFailed"));
      throw new Error("Unsupported hero image type");
    }

    if (file.size > MAX_HERO_IMAGE_BYTES) {
      safeWarn("hero-image.fileTooLarge", file.size);
      toast.error(t("admin.heroSlides.errors.uploadFailed"));
      throw new Error("Hero image too large");
    }

    const fileExt = file.name.split(".").pop();
    const fallbackExt = file.type.split("/")[1];
    const normalizedExt = (fileExt || fallbackExt || "bin").replace(/[^a-z0-9]/gi, "");
    const fileName = `${crypto.randomUUID()}.${normalizedExt || "bin"}`;
    const filePath = `slides/${fileName}`;

    const { error: uploadError } = await aisha.storage
      .from("hero-images")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      safeError("hero-image.upload", uploadError);
      toast.error(t("admin.heroSlides.errors.uploadFailed"));
      throw uploadError;
    }

    const { data: { publicUrl } } = aisha.storage
      .from("hero-images")
      .getPublicUrl(filePath);

    return publicUrl;
  };

  return { uploadImage };
}
