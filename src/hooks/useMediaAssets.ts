/**
 * Galerie nahraných médií (media_assets) — čtení, mazání, veřejná adresa.
 *
 * Úložiště výpis objektů neumí; evidenci zapisuje storage-auth po průchodu
 * antivirem (record_media_asset). Mazání jde dvěma kroky: nejdřív objekt
 * (DELETE /object/<bucket>/<klíč>, admin/staff), pak záznam — aby galerie
 * nikdy nenabízela obrázek, který v úložišti chybí.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { storage } from "@/integrations/api/storage";
import { safeError } from "@/lib/security/safeLogger";
import { MediaAssetSchema, parseRpcArrayResponse, type MediaAsset } from "@/schemas/rpcResponseSchemas";

export type { MediaAsset };

export const MEDIA_QUERY_KEY = "media-assets";

export function verejnaAdresaMedia(m: Pick<MediaAsset, "bucket" | "object_key">): string {
  return storage.from(m.bucket).getPublicUrl(m.object_key).data.publicUrl;
}

export function useMediaAssets(hledani = "", limit = 60) {
  return useQuery({
    queryKey: [MEDIA_QUERY_KEY, hledani.trim(), limit] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<MediaAsset[]> => {
      const { data, error } = await aisha.rpc("get_media_assets_admin", {
        p_limit: limit,
        p_offset: 0,
        p_search: hledani.trim() || undefined,
      });
      if (error) {
        safeError("media-assets.fetch", error);
        throw new Error(error.message);
      }
      return parseRpcArrayResponse(MediaAssetSchema, data);
    },
  });
}

export function useDeleteMediaAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: MediaAsset) => {
      const { error: chybaObjektu } = await storage.from(m.bucket).remove([m.object_key]);
      if (chybaObjektu) {
        safeError("media-assets.delete-object", chybaObjektu);
        throw new Error(chybaObjektu.message);
      }
      const { error } = await aisha.rpc("delete_media_asset_admin", { p_id: m.id });
      if (error) {
        safeError("media-assets.delete-record", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [MEDIA_QUERY_KEY] }),
  });
}

/** Po nahrání je záznam nový — galerie se má načíst znovu. */
export function useInvalidateMediaAssets() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [MEDIA_QUERY_KEY] });
}
