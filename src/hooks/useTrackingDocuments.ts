import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from './useSession';
import { useSecureMode } from './useSecureMode';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { safeError, safeWarn } from '@/lib/security/safeLogger';
import { z } from 'zod';
import { invokeEdgeFunctionLegacy as invokeEdgeFunction } from '@/integrations/api/edge';
import { storage, dokonciNahrani } from '@/integrations/api/storage';

import type { ApiClient } from '@/integrations/api/client';
import type { Database, Json } from '@/integrations/db/types';

export type TrackingDocumentCategory = Database["public"]["Enums"]["health_document_category"];

export type DocumentProcessingStatus = Database["public"]["Enums"]["document_processing_status"];

/**
 * Represents a health document uploaded by a user.
 */
export interface TrackingDocument {
  /** Unique identifier for the document */
  id: string;
  /** ID of the user who owns the document */
  user_id: string;
  /** Optional ID of the study registration this document is related to */
  study_registration_id: string | null;
  /** Original name of the uploaded file */
  file_name: string;
  /** Storage path of the file */
  file_path: string;
  /** Size of the file in bytes */
  file_size: number | null;
  /** MIME type of the file */
  mime_type: string | null;
  /** Category of the health document */
  category: TrackingDocumentCategory;
  /** User-provided title for the document */
  title: string | null;
  /** User-provided description */
  description: string | null;
  /** Date associated with the document content */
  document_date: string | null;
  /** Current processing status of the document */
  processing_status: DocumentProcessingStatus;
  /** Timestamp when processing was completed */
  processed_at: string | null;
  /** Structured data extracted from the document */
  extracted_data: Json | null;
  /** Raw text extracted from the document */
  extracted_text: string | null;
  /** AI-generated summary of the document */
  ai_summary: string | null;
  /** AI-generated insights from the document */
  ai_insights: Json | null;
  /** AI-generated categories */
  ai_categories: string[] | null;
  /** Number of tokens awarded for this document */
  tokens_awarded: number;
  /** Timestamp when tokens were awarded */
  tokens_awarded_at: string | null;
  /** Whether the document contributed to aggregate statistics */
  contributed_to_statistics: boolean;
  /** Timestamp when the document contributed to statistics */
  contributed_at: string | null;
  /** Timestamp of creation */
  created_at: string;
  /** Timestamp of last update */
  updated_at: string;
}

/**
 * Represents sharing permissions for a specific document.
 */
export interface DocumentSharingPermission {
  /** Unique identifier for the permission record */
  id: string;
  /** ID of the document being shared */
  document_id: string;
  /** ID of the user who owns the document */
  user_id: string;
  /** ID of the partner the document is shared with */
  shared_with_partner_id: string | null;
  /** ID of the study the document is shared with */
  shared_with_study_id: string | null;
  /** Whether the recipient can view the document */
  can_view: boolean;
  /** Whether the document can be used for statistics */
  can_use_for_statistics: boolean;
  /** Whether the document can be used for research */
  can_use_for_research: boolean;
  /** Timestamp when permission was granted */
  granted_at: string;
  /** Timestamp when permission was revoked (null if active) */
  revoked_at: string | null;
  /** Timestamp of creation */
  created_at: string;
  /** Timestamp of last update */
  updated_at: string;
  /** Details of the partner (if shared with a partner) */
  partner_profile?: {
    id: string;
    display_name: string;
    business_name: string | null;
  };
  /** Details of the study (if shared with a study) */
  study?: {
    id: string;
    name: string;
    code: string;
  };
}

/**
 * Hook to fetch the current user's health documents.
 * Requires secure mode to be enabled.
 * 
 * @returns Query result containing the list of health documents.
 */
export function useTrackingDocuments() {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();

  return useQuery({
    queryKey: ['health-documents', user?.id],
    queryFn: async (): Promise<TrackingDocument[]> => {
      if (!user?.id || !secureClient) return [];

      const { data, error } = await secureClient.rpc('get_my_health_documents_audited');

      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: isPhiEnabled && !!user?.id && !!secureClient,
    // Ensure we always fetch fresh data when query becomes enabled
    staleTime: 0,
  });
}

/**
 * Hook to fetch sharing permissions for a specific document.
 * Requires secure mode to be enabled.
 * 
 * @param documentId - The ID of the document to fetch permissions for.
 * @returns Query result containing the list of sharing permissions.
 */
export function useDocumentSharingPermissions(documentId: string) {
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();

  return useQuery({
    queryKey: ['document-sharing', documentId],
    queryFn: async () => {
      if (!secureClient) return [];

      const { data, error } = await secureClient.rpc('get_my_document_sharing_permissions_audited', {
        p_document_id: documentId,
      });

      if (error) throw new Error(error.message);
      
      // Schema defined locally for sensitive data document permissions
      const permissionSchema = z.array(z.object({
        id: z.string(),
        document_id: z.string(),
        user_id: z.string(),
        shared_with_partner_id: z.string().nullable(),
        shared_with_study_id: z.string().nullable(),
        can_view: z.boolean().nullable(),
        can_use_for_research: z.boolean().nullable(),
        can_use_for_statistics: z.boolean().nullable(),
        granted_at: z.string(),
        revoked_at: z.string().nullable(),
        created_at: z.string(),
        updated_at: z.string(),
      }));
      
      const parsed = permissionSchema.safeParse(data);
      return (parsed.success ? parsed.data : []) as DocumentSharingPermission[];
    },
    enabled: isPhiEnabled && !!secureClient && !!documentId,
  });
}

/**
 * Hook to upload a health document.
 * Handles preflight check, signed URL upload, and cleanup on failure.
 *
 * @returns Mutation object for uploading a document.
 */
export function useUploadTrackingDocument() {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const queryClient = useQueryClient();

  // storage-auth /upload-preflight returns a MinIO presigned PUT target (the legacy
  // hosted-storage SDK's uploadToSignedUrl is banned platform-wide). The client PUTs
  // the raw file bytes to `uploadUrl` with Content-Type = mimeType.
  const preflightSchema = z.object({
    documentId: z.string(),
    uploadUrl: z.string(),
    // Klíč v KARANTÉNNÍM bucketu — ten se ohlašuje na /upload-complete, které
    // dokument oskenuje a teprve pak promuje do `health-documents`.
    quarantineKey: z.string(),
    objectKey: z.string(),
    bucket: z.string().optional(),
    mimeType: z.string().optional(),
    expiresIn: z.number().optional(),
  });

  return useMutation({
    mutationFn: async ({
      file,
      category,
      title,
      description,
      documentDate,
      studyRegistrationId,
    }: {
      file: File;
      category: TrackingDocumentCategory;
      title?: string;
      description?: string;
      documentDate?: string;
      studyRegistrationId?: string;
    }) => {
      if (!isPhiEnabled || !secureClient || !user?.id) throw new Error('Not authenticated');

      const preflightData = await invokeEdgeFunction(secureClient, {
        functionName: 'upload-health-document-preflight',
        context: 'useUploadTrackingDocument.preflight',
        schema: preflightSchema,
        body: {
          filename: file.name,
          mimeType: file.type,
          size: file.size,
          category,
          title: title || file.name,
          description,
          documentDate,
          studyRegistrationId,
        },
      });

      const resolvedMimeType = preflightData.mimeType ?? file.type;

      // PUT the raw bytes directly to the presigned MinIO URL (the URL carries its own
      // short-lived signature — no Authorization header needed).
      let uploadOk = false;
      let uploadError: unknown;
      try {
        const putRes = await fetch(preflightData.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': resolvedMimeType || 'application/octet-stream' },
          signal: AbortSignal.timeout(30000),
        });
        uploadOk = putRes.ok;
        if (!putRes.ok) {
          uploadError = new Error(`Upload failed (${putRes.status})`);
        }
      } catch (err) {
        uploadError = err;
      }

      // ⛔ DOKUMENT JDE PŘES KARANTÉNU (2026-09-21, upřesněno 2026-09-23).
      //
      // PUT doručí bajty do karanténního bucketu, ne do `health-documents`. Přes API
      // proběhne sken (clamd, fail-closed) už na konci PUTu a verdikt se zapíše do
      // řádku z podepsaného tokenu; na presigned cestě ho spustí až tohle ohlášení.
      // Ohlášení je idempotentní, takže se volá vždy. Infikovaný soubor skončí 422, nedostupný skener
      // 502 — v obou případech se dokument NEPROMUJE, takže se selhání musí
      // propsat stejně jako selhání PUT, jinak by uživatel viděl „nahráno"
      // u dokumentu, ke kterému se nikdy nedostane.
      if (uploadOk) {
        const dokonceno = await dokonciNahrani(
          preflightData.quarantineKey,
          preflightData.documentId,
        );
        if (dokonceno.error) {
          uploadOk = false;
          uploadError = new Error(dokonceno.error.message);
        }
      }

      if (!uploadOk) {
        // Best-effort cleanup: remove the DB row if the upload fails.
        try {
          await secureClient.rpc('delete_my_health_document_audited', {
            p_document_id: preflightData.documentId,
          });
        } catch (cleanupError) {
          safeWarn('useUploadTrackingDocument.cleanupFailed', cleanupError);
        }
        throw uploadError instanceof Error ? uploadError : new Error('Upload failed');
      }

      return { id: preflightData.documentId };
    },
    onSuccess: () => {
      // Invalidate all health-documents queries - this will refetch any mounted observers
      queryClient.invalidateQueries({ 
        queryKey: ['health-documents'],
        // Force refetch even for queries with enabled: false conditions that are now met
        refetchType: 'all',
      });
      toast.success(i18n.t('trackingDocuments.uploadSuccess'));
    },
    onError: (error) => {
      safeError('useUploadTrackingDocument.onError', error);
      toast.error(i18n.t('trackingDocuments.uploadError'));
    },
  });
}

/**
 * Hook to delete a health document.
 * Removes file from storage and deletes database record.
 *
 * @returns Mutation object for deleting a document.
 */
export function useDeleteTrackingDocument() {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (document: TrackingDocument) => {
      if (!isPhiEnabled || !secureClient || !user) throw new Error('Not authenticated');

      // Delete the object via the canonical storage module (DELETE /storage/v1/*,
      // authenticated with the caller's access token). ApiClient has no storage
      // surface, so storage operations go through @/integrations/api/storage.
      const { error: storageError } = await storage
        .from('health-documents')
        .remove([document.file_path]);

      if (storageError) safeWarn('useDeleteTrackingDocument.storageRemove', storageError);

      // Delete record
      const { error } = await secureClient.rpc('delete_my_health_document_audited', {
        p_document_id: document.id,
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-documents'], refetchType: 'all' });
      toast.success(i18n.t('trackingDocuments.deleteSuccess'));
    },
    onError: () => {
      toast.error(i18n.t('trackingDocuments.deleteError'));
    },
  });
}

// Grant sharing permission
export function useGrantDocumentSharing() {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      partnerId,
      studyId,
      canView = true,
      canUseForStatistics = false,
      canUseForResearch = false,
    }: {
      documentId: string;
      partnerId?: string;
      studyId?: string;
      canView?: boolean;
      canUseForStatistics?: boolean;
      canUseForResearch?: boolean;
    }) => {
      if (!isPhiEnabled || !secureClient || !user?.id) throw new Error('Not authenticated');

      const { data, error } = await secureClient.rpc('grant_document_sharing_permission_audited', {
        p_can_use_for_research: canUseForResearch
,
        p_can_use_for_statistics: canUseForStatistics,
        p_can_view: canView,
        p_document_id: documentId,
        p_partner_id: partnerId ?? undefined,
        p_study_id: studyId ?? undefined
    });

      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      return row;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['document-sharing', variables.documentId] });
      toast.success(i18n.t('trackingDocuments.shareSuccess'));
    },
    onError: () => {
      toast.error(i18n.t('trackingDocuments.shareError'));
    },
  });
}

// Revoke sharing permission
export function useRevokeDocumentSharing() {
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ permissionId, documentId }: { permissionId: string; documentId: string }) => {
      if (!isPhiEnabled || !secureClient) throw new Error('Not authenticated');

      const { error } = await secureClient.rpc('revoke_document_sharing_permission_audited', {
        p_permission_id: permissionId,
      });

      if (error) throw new Error(error.message);
      return documentId;
    },
    onSuccess: (documentId) => {
      queryClient.invalidateQueries({ queryKey: ['document-sharing', documentId] });
      toast.success(i18n.t('trackingDocuments.revokeSuccess'));
    },
    onError: () => {
      toast.error(i18n.t('trackingDocuments.revokeError'));
    },
  });
}

// Analyze document with AI
export function useAnalyzeDocument() {
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const queryClient = useQueryClient();

  const analyzeSchema = z.object({
    success: z.boolean().optional(),
    analysis: z.unknown().optional(),
    tokens_awarded: z.number().optional(),
  });

  return useMutation({
    mutationFn: async ({
      documentId,
      customRedactions,
    }: {
      documentId: string;
      customRedactions?: string[];
    }) => {
      if (!isPhiEnabled || !secureClient) throw new Error('Not authenticated');

      return invokeEdgeFunction(secureClient, {
        functionName: 'analyze-health-document',
        context: 'useAnalyzeDocument',
        schema: analyzeSchema,
        body: {
          documentId,
          customRedactions: customRedactions ?? [],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-documents'], refetchType: 'all' });
      toast.success(i18n.t('trackingDocuments.analysisSuccess'));
    },
    onError: (error) => {
      safeError('useAnalyzeDocument.onError', error);
      toast.error(i18n.t('trackingDocuments.analysisError'));
    },
  });
}

// Contribute document to statistics
export function useContributeToStatistics() {
  const { user } = useSession();
  const { isEnabled: isPhiEnabled, secureClient } = useSecureMode();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      if (!isPhiEnabled || !secureClient || !user) throw new Error('Not authenticated');

      const { data, error } = await secureClient.rpc('mark_health_document_contributed_audited', {
        p_document_id: documentId,
      });

      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      return row;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health-documents'], refetchType: 'all' });
      toast.success(i18n.t('trackingDocuments.contributeSuccess'));
    },
    onError: () => {
      toast.error(i18n.t('trackingDocuments.contributeError'));
    },
  });
}

// Get document download URL
export async function getDocumentUrl(
  documentId: string,
  client: ApiClient
): Promise<string | null> {
  const downloadSchema = z.object({
    signedUrl: z.string(),
    expiresInSeconds: z.number().optional(),
  });

  try {
    const data = await invokeEdgeFunction(client, {
      functionName: 'download-health-document',
      context: 'getDocumentUrl',
      schema: downloadSchema,
      body: { documentId },
    });
    return data.signedUrl;
  } catch (error) {
    safeError('getDocumentUrl', error);
    return null;
  }
}
