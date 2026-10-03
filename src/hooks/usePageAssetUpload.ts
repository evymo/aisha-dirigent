/**
 * Hook for uploading page builder assets (images) through the AISHA storage API.
 *
 * Uses the MinIO-backed `page-assets` bucket. Returns upload + delete functions
 * compatible with GrapesJS AssetManager custom upload handler.
 *
 * @module
 */

import { useTranslation } from "react-i18next";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";

const BUCKET = "page-assets";
/** 20 MB: fotka z telefonu má 3–8 MB; 5 MB (do 2026-09-24) odmítalo běžný JPG. */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
/**
 * ⛔ SEZNAM MUSÍ BÝT PODMNOŽINOU SERVEROVÉHO (naměřeno 2026-09-21).
 *
 * `image/svg+xml` tu byl, ale `config.allowedMimeTypes` ve `storage-auth` ho
 * nemá — preflight by SVG odmítl 415, tedy až po výběru souboru, hláškou
 * „nahrání selhalo" bez důvodu. A je to tak správně: SVG je dokument, který smí
 * nést `<script>`, a servírovaný z naší veřejné domény by to byl uložený XSS.
 * Klient proto SVG nenabízí (řekne to hned), místo aby ho server odmítal.
 *
 * HEIC/HEIF (2026-09-24): fotky z iPhonu se nahrají tak, jak jsou; prohlížeči
 * je doručí storage-auth převedené přes imgproxy. V prohlížeči se nic nepřevádí.
 */
export const ALLOWED_ASSET_TYPES = new Set([
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface UploadAssetOptions {
  onProgress?: (podil: number) => void;
  signal?: AbortSignal;
}

/**
 * Provides upload/delete utilities for page builder image assets.
 */
export function usePageAssetUpload() {
  const { t } = useTranslation();

  /**
   * Upload a file to the page-assets bucket.
   *
   * @param file - The file to upload
   * @returns The public URL of the uploaded asset
   */
  const uploadAsset = async (file: File, options?: UploadAssetOptions): Promise<string> => {
    if (!ALLOWED_ASSET_TYPES.has(file.type)) {
      throw new Error(t("builder.assets.invalidType"));
    }
    if (file.size > MAX_ASSET_BYTES) {
      throw new Error(t("builder.assets.tooLarge"));
    }

    // ⛔ KLÍČ OBJEKTU RAZÍ SERVER, NE TENHLE HOOK (naměřeno 2026-09-21).
    //
    // Dřív si hook vymyslel `pages/<uuid>.<ext>` a tou cestou si pak sám složil
    // veřejnou adresu. Preflight ve `storage-auth` ale klíč razí vlastní
    // (`<userId>/<uuid>_<jméno>`, krok 5 upload-preflight.ts) — takže i kdyby
    // nahrávání fungovalo, adresa by mířila jinam, než co se nahrálo.
    // Předávané jméno slouží už jen k odvození přípony a k sanitizaci; ZÁVAZNÝ
    // je `data.path`, který vrátil server.
    const { data, error } = await aisha.storage
      .from(BUCKET)
      .upload(file.name, file, { contentType: file.type, onProgress: options?.onProgress, signal: options?.signal });

    if (error || !data) {
      safeError("pageAssetUpload.failed", error);
      // Kód chyby říká, co se stalo (antivirus, sken nedostupný, typ, velikost) —
      // volající ho smí přeložit; jinak obecná hláška.
      const chyba = new Error(error?.message ?? t("builder.assets.uploadFailed"));
      (chyba as Error & { code?: string }).code = error?.code;
      throw chyba;
    }

    const {
      data: { publicUrl },
    } = aisha.storage.from(BUCKET).getPublicUrl(data.path);

    return publicUrl;
  };

  /**
   * Delete an asset from the page-assets bucket.
   *
   * @param assetUrl - Public URL of the asset to remove
   */
  const deleteAsset = async (assetUrl: string): Promise<void> => {
    const bucketBaseUrl = aisha.storage
      .from(BUCKET)
      .getPublicUrl("").data.publicUrl;
    const filePath = assetUrl.replace(bucketBaseUrl, "").split("?")[0];
    if (!filePath) return;

    const { error } = await aisha.storage.from(BUCKET).remove([filePath]);
    if (error) {
      safeError("pageAssetDelete.failed", error);
    }
  };

  return { deleteAsset, uploadAsset };
}
