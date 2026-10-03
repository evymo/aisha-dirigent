import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";
import { safeError } from "@/lib/security/safeLogger";
import { z } from "zod";

/**
 * Schema for the biomarkers object within the lab result detail.
 * Only non-null biomarkers are returned by the RPC (via jsonb_strip_nulls).
 */
const biomarkersSchema = z.record(z.string(), z.number()).default({});

/**
 * Schema for the lab result detail returned from the RPC.
 */
const labResultDetailSchema = z.object({
  biomarkers: biomarkersSchema,
  created_at: z.string().nullable(),
  file_url: z.string().nullable(),
  id: z.string(),
  lab_name: z.string().nullable(),
  notes: z.string().nullable(),
  result_date: z.string().nullable(),
  results: z.unknown().nullable(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
  reviewer_display_name: z.string().nullable(),
  status: z.string().nullable(),
  test_date: z.string(),
  test_type: z.string().nullable(),
  updated_at: z.string().nullable(),
  user_id: z.string(),
});

export type LabResultDetail = z.infer<typeof labResultDetailSchema>;

/**
 * Hook to fetch a single lab result detail with audit logging.
 *
 * @param labResultId - The UUID of the lab result to fetch
 * @param options - Query options (enabled)
 */
export function useLabResultDetail(
  labResultId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["lab-result-detail", labResultId],
    queryFn: async (): Promise<LabResultDetail> => {
      if (!labResultId) throw new Error("Lab result ID is required");

      const { data, error } = await aisha.rpc(
        "get_lab_result_detail_audited",
        { p_lab_result_id: labResultId },
      );

      if (error) {
        safeError("useLabResultDetail.fetch", error);
        throw new Error(error.message);
      }

      if (!data || typeof data !== "object") {
        throw new Error("Empty lab result data");
      }

      return labResultDetailSchema.parse(data);
    },
    enabled: !!labResultId && (options?.enabled !== false),
    staleTime: 2 * 60 * 1000,
  });
}
