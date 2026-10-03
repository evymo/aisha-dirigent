import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toast } from "sonner";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { usePermissions } from "@/hooks/usePermissions";
import i18n from "@/i18n";
import {
  adminArchiveDocumentArraySchema,
  parseArrayResponse,
  type AdminArchiveDocument,
} from "@/lib/schemas/adminSchemas";
import { z } from "zod";
import type { Json } from "@/integrations/db/types";

const t = (key: string) => i18n.t(key);

// Input schema for create/update operations
export const archiveDocumentInputSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  document_type: z.string(),
  provenance_badge: z.string(),
  year: z.number().int().nullable().optional(),
  decade: z.string().nullable().optional(),
  facility: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  preparation: z.string().nullable().optional(),
  scan_url: z.string().nullable().optional(),
  transcript_url: z.string().nullable().optional(),
  editorial_note: z.string().nullable().optional(),
  what_you_are_looking_at: z.string().nullable().optional(),
  standards_context: z.string().nullable().optional(),
  source_publication: z.string().nullable().optional(),
  original_language: z.string().nullable().optional(),
  page_count: z.number().int().nullable().optional(),
  is_featured: z.boolean().optional(),
  is_download_public: z.boolean().optional(),
  people: z.array(z.string()).nullable().optional(),
  keywords: z.array(z.string()).nullable().optional(),
});

export type ArchiveDocumentInput = z.infer<typeof archiveDocumentInputSchema>;

/**
 * Hook to fetch all archive documents for admin dashboard.
 * Uses RPC `get_archive_documents_admin` to retrieve full document details.
 *
 * @returns Query object containing list of archive documents.
 */
export function useArchiveDocumentsAdmin() {
  const { hasPermission } = usePermissions();
  const isAdmin = hasPermission("view_admin_dashboard");

  return useQuery({
    queryKey: ["admin-archive-documents"],
    queryFn: async (): Promise<AdminArchiveDocument[]> => {
      if (!isAdmin) return [];
      const { data, error } = await aisha.rpc("get_archive_documents_admin");
      if (error) throw new Error(error.message);
      return parseArrayResponse(
        adminArchiveDocumentArraySchema,
        data,
        "get_archive_documents_admin"
      );
    },
    enabled: isAdmin,
  });
}

/**
 * Hook to create a new archive document.
 * Validates input using Zod schema before sending to RPC.
 *
 * @returns Mutation object for creating a document.
 */
export function useCreateArchiveDocument() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("create_archive_document_admin", async (input: ArchiveDocumentInput): Promise<string> => {
      // Validate input
      const validatedInput = archiveDocumentInputSchema.parse(input);
      
      // Convert to JSONB format for RPC
      const { data, error } = await aisha.rpc("create_archive_document_admin", {
        p_data: validatedInput as Json,
      });
      
      if (error) throw new Error(error.message);
      return data as string;
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-archive-documents"] });
      toast.success(t("admin.archive.created"));
    },
    onError: () => {
      toast.error(t("admin.archive.errors.createFailed"));
    },
  });
}

/**
 * Hook to update an existing archive document.
 * Supports partial updates.
 *
 * @returns Mutation object for updating a document.
 */
export function useUpdateArchiveDocument() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("update_archive_document_admin", async ({ id, data }: { id: string; data: Partial<ArchiveDocumentInput> }): Promise<void> => {
      // Validate partial input (only validate provided fields)
      const partialSchema = archiveDocumentInputSchema.partial();
      const validatedData = partialSchema.parse(data);
      
      const { error } = await aisha.rpc("update_archive_document_admin", {
        p_data: validatedData as Json
,
        p_id: id
    });
      
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-archive-documents"] });
      toast.success(t("admin.archive.updated"));
    },
    onError: () => {
      toast.error(t("admin.archive.errors.updateFailed"));
    },
  });
}

/**
 * Hook to delete an archive document
 */
export function useDeleteArchiveDocument() {
  const queryClient = useQueryClient();
  const { guardAdminMutation } = useAdminGuard();

  return useMutation({
    mutationFn: guardAdminMutation("delete_archive_document_admin", async (id: string): Promise<void> => {
      const { error } = await aisha.rpc("delete_archive_document_admin", {
        p_id: id,
      });
      
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-archive-documents"] });
      toast.success(t("admin.archive.deleted"));
    },
    onError: () => {
      toast.error(t("admin.archive.errors.deleteFailed"));
    },
  });
}
