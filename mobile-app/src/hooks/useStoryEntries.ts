/**
 * Hook for adding entries to a story thread.
 * Uses add_timeline_entry_audited RPC.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import { safeError } from "@/lib/security/safeLogger";
import type { Json } from "@/types/database";

type EntryType = "note" | "health_event" | "document" | "message";

interface AddEntryParams {
  storyId: string;
  entryType: EntryType;
  content: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  documentId?: string;
}

export function useAddEntry() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: AddEntryParams) => {
      const { data, error } = await api.rpc("add_timeline_entry_audited", {
        p_content: params.content,
        p_document_id: params.documentId ?? undefined,
        p_entry_type: params.entryType,
        p_metadata: params.metadata as Json | undefined,
        p_occurred_at: params.occurredAt ?? undefined,
        p_story_id: params.storyId,
      });
      if (error) {
        safeError("useAddEntry.mutate", error);
        throw error;
      }
      return data;
    },
    onSuccess: (_data, params) => {
      qc.invalidateQueries({ queryKey: ["project-detail", params.storyId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
