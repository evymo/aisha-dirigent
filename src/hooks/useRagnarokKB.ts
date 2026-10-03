/**
 * Hook for managing Ragnarok knowledge bases (list, upload, delete).
 * Calls the ragnarok-upload edge function with admin/staff authorization.
 *
 * @module
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { getAccessToken } from "@/integrations/auth/oidc-client";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

const ragnarokKbSchema = (defaultProjectId: string) => z.object({
  kb_id: z.string().optional(),
  id: z.string().optional(),
  _id: z.string().optional(),
  project_id: z.string().optional(),
  document_count: z.number().nullable().optional(),
  total_pages: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).transform((row) => ({
  kb_id: row.kb_id ?? row.id ?? row._id ?? "",
  project_id: row.project_id ?? defaultProjectId,
  document_count: row.document_count ?? row.total_pages ?? undefined,
  created_at: row.created_at ?? undefined,
})).refine((row) => row.kb_id.length > 0, { message: "Missing Ragnarok KB id" });

const ragnarokKbStringSchema = (defaultProjectId: string) => z.string().transform((kbId) => ({
  kb_id: kbId,
  project_id: defaultProjectId,
}));

const ragnarokKbItemSchema = (defaultProjectId: string) => z.union([
  ragnarokKbStringSchema(defaultProjectId),
  ragnarokKbSchema(defaultProjectId),
]);

const ragnarokListResponseSchema = (defaultProjectId: string) => z.object({
  knowledge_bases: z.array(ragnarokKbItemSchema(defaultProjectId)).optional(),
  data: z.array(ragnarokKbItemSchema(defaultProjectId)).optional(),
}).passthrough().transform((response) => ({
  knowledge_bases: response.knowledge_bases ?? response.data ?? [],
}));

/**
 * Response shape returned by `ragnarok-upload` (action=upload).
 *
 * Validates the minimum subset of fields the UI consumes. Extra fields
 * (debug metadata, processing stats) are tolerated via `.passthrough()`.
 */
export const ragnarokUploadResponseSchema = z
  .object({
    kb_id: z.string().optional(),
    filename: z.string().optional(),
    size_bytes: z.number().optional(),
    uploaded_at: z.string().optional(),
    language: z.string().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type RagnarokUploadResponse = z.infer<typeof ragnarokUploadResponseSchema>;

type RagnarokKB = {
  kb_id: string;
  project_id: string;
  document_count?: number;
  created_at?: string;
};

const QUERY_KEY = ["ragnarok-kb-list"];

const getGatewayUrl = (): string => {
  const configured = import.meta.env.VITE_AISHA_GATEWAY_URL?.trim();
  if (!configured) {
    throw new Error("Missing gateway URL. Set VITE_AISHA_GATEWAY_URL.");
  }
  return configured.replace(/\/+$/, "");
};

/**
 * Fetch list of Ragnarok knowledge bases.
 */
export function useRagnarokKBList(projectId = "aisha") {
  return useQuery({
    queryKey: [...QUERY_KEY, projectId],
    queryFn: async (): Promise<RagnarokKB[]> => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const gatewayUrl = getGatewayUrl();

      const response = await fetch(`${gatewayUrl}/functions/v1/ragnarok-upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "list", project_id: projectId }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        const errBody = await response.json().catch((_parseErr) => ({}));
        throw new Error((errBody as Record<string, string>).error ?? `List failed: ${response.status}`);
      }

      const parsed = ragnarokListResponseSchema(projectId).safeParse(await response.json());
      if (!parsed.success) {
        safeError("ragnarokKb.listValidationFailed", parsed.error);
        throw new Error("Invalid Ragnarok KB list response");
      }

      return parsed.data.knowledge_bases ?? [];
    },
    staleTime: 30_000,
  });
}

/**
 * Upload a file to Ragnarok knowledge base.
 */
export function useRagnarokUpload() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (params: {
      file: File;
      kb_id?: string;
      project_id?: string;
      language?: string;
    }) => {
      const formData = new FormData();
      formData.append("file", params.file);
      formData.append("action", "upload");
      if (params.kb_id) formData.append("kb_id", params.kb_id);
      formData.append("project_id", params.project_id ?? "aisha");
      if (params.language) formData.append("language", params.language);

      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const gatewayUrl = getGatewayUrl();

      const response = await fetch(
        `${gatewayUrl}/functions/v1/ragnarok-upload`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          signal: AbortSignal.timeout(60_000),
        },
      );

      if (!response.ok) {
        const errBody = await response.json().catch((_parseErr) => ({}));
        throw new Error((errBody as Record<string, string>).error ?? `Upload failed: ${response.status}`);
      }

      return ragnarokUploadResponseSchema.parse(await response.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({
        title: t("admin.ragnarokKb.uploadSuccess"),
      });
    },
    onError: (error: unknown) => {
      safeError("ragnarokKb.uploadFailed", error);
      toast({
        title: t("admin.ragnarokKb.uploadError"),
        variant: "destructive",
      });
    },
  });
}

/**
 * Delete a Ragnarok knowledge base.
 */
export function useRagnarokDelete() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (params: { kb_id: string; project_id?: string }) => {
      const { data, error } = await aisha.functions.invoke("ragnarok-upload", {
        body: {
          action: "delete",
          kb_id: params.kb_id,
          project_id: params.project_id ?? "aisha",
        },
      });

      if (error) throw new Error(String(error.message ?? error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: t("admin.ragnarokKb.deleteSuccess") });
    },
    onError: (error: unknown) => {
      safeError("useDeleteRagnarokKB.failed", error);
      toast({
        title: t("admin.ragnarokKb.deleteError"),
        variant: "destructive",
      });
    },
  });
}
