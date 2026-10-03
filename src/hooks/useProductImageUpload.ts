/**
 * Hook for uploading product images to Supabase Storage
 * 
 * Uses the 'product-images' bucket with validation for file type and size.
 */

import { aisha } from "@/integrations/db/client";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { safeError } from "@/lib/security/safeLogger";

const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_PRODUCT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export function useProductImageUpload() {
  const { t } = useTranslation();

  const uploadImage = async (file: File): Promise<string> => {
    // Validate file type
    if (!ALLOWED_PRODUCT_IMAGE_TYPES.has(file.type)) {
      toast.error(t("admin.products.errors.invalidImageType"));
      throw new Error("Unsupported image type");
    }

    // Validate file size
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      toast.error(t("admin.products.errors.imageTooLarge"));
      throw new Error("Image too large");
    }

    // Generate unique filename
    const extension = file.type.split("/")[1];
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const filePath = `products/${fileName}`;

    // Upload to Supabase Storage
    const { error } = await aisha.storage
      .from("product-images")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      toast.error(t("admin.products.errors.uploadFailed"));
      throw new Error(error.message);
    }

    // Get public URL
    const { data: { publicUrl } } = aisha.storage
      .from("product-images")
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const deleteImage = async (imageUrl: string): Promise<void> => {
    // Extract file path from URL
    const bucketUrl = aisha.storage.from("product-images").getPublicUrl("").data.publicUrl;
    const filePath = imageUrl.replace(bucketUrl, "");

    if (!filePath) return;

    const { error } = await aisha.storage
      .from("product-images")
      .remove([filePath]);

    if (error) {
      safeError("admin.products.imageDeleteFailed", error);
      // Don't throw - deletion failure is not critical
    }
  };

  return { uploadImage, deleteImage };
}
