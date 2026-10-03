/**
 * Hook pro autorizovaný přístup k download info zdravotního dokumentu.
 *
 * Používá audited RPC funkci pro ověření oprávnění a consent checky.
 *
 * @module hooks/useTrackingDocumentDownloadInfo
 */

import { useMutation } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { useSession } from "@/hooks/useSession";

/**
 * Informace pro stažení zdravotního dokumentu
 */
export interface TrackingDocumentDownloadInfo {
  id: string;
  file_path: string;
  user_id: string;
}

/**
 * Hook pro získání autorizovaného download info pro zdravotní dokument.
 *
 * Používá audited RPC pro zajištění consent a access checks.
 *
 * @returns Mutation hook pro získání download info
 *
 * @example
 * const { mutateAsync: getDownloadInfo } = useTrackingDocumentDownloadInfo();
 *
 * const info = await getDownloadInfo(documentId);
 * // Použij info.file_path pro signed URL
 */
export function useTrackingDocumentDownloadInfo() {
  const { user } = useSession();

  return useMutation({
    mutationFn: async (documentId: string): Promise<TrackingDocumentDownloadInfo> => {
      if (!user?.id) {
        throw new Error("Authentication required");
      }

      const { data, error } = await aisha.rpc("get_health_document_download_info_audited", {
        p_document_id: documentId,
      });

      if (error) {
        safeError("healthDocuments.downloadInfoFailed", error);
        throw new Error(error.message);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.file_path) {
        throw new Error("Tracking document download info not found");
      }

      return row as TrackingDocumentDownloadInfo;
    },
  });
}
