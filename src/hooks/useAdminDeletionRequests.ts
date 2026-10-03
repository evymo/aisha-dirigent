import { useQuery } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";

interface AdminDeletionRequest {
  id: string;
  user_id: string;
  user_email: string;
  display_name: string;
  reason: string | null;
  feedback: string | null;
  requested_at: string;
  scheduled_deletion_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
  status: string;
  processed_by: string | null;
}

/**
 * Parameters for the admin deletion requests query.
 */
export interface UseAdminDeletionRequestsParams {
  limit?: number;
  offset?: number;
  status?: string | null;
}

/**
 * Admin hook for listing account deletion requests.
 * Requires admin/staff permissions.
 *
 * @param params - Optional filtering params (limit, offset, status).
 * @returns Query result with deletion requests data.
 *
 * @example
 * const { data, isLoading } = useAdminDeletionRequests({ status: "pending" });
 */
export function useAdminDeletionRequests(params: UseAdminDeletionRequestsParams = {}) {
  const { limit = 50, offset = 0, status = null } = params;

  return useQuery<AdminDeletionRequest[]>({
    queryKey: ["admin-deletion-requests", limit, offset, status],
    queryFn: async () => {
      const { data, error } = await aisha.rpc(
        "get_account_deletion_requests_admin",
        {
          p_limit: limit,
          p_offset: offset,
          p_status: status ?? undefined,
        }
      );

      if (error) throw new Error(error.message);

      if (!Array.isArray(data)) return [];

      return data.map((row: Record<string, unknown>): AdminDeletionRequest => ({
        id: String(row.id ?? ""),
        user_id: String(row.user_id ?? ""),
        user_email: String(row.user_email ?? ""),
        display_name: String(row.display_name ?? ""),
        reason: row.reason != null ? String(row.reason) : null,
        feedback: row.feedback != null ? String(row.feedback) : null,
        requested_at: String(row.requested_at ?? ""),
        scheduled_deletion_at: String(row.scheduled_deletion_at ?? ""),
        cancelled_at: row.cancelled_at != null ? String(row.cancelled_at) : null,
        completed_at: row.completed_at != null ? String(row.completed_at) : null,
        status: String(row.status ?? ""),
        processed_by: row.processed_by != null ? String(row.processed_by) : null,
      }));
    },
  });
}
