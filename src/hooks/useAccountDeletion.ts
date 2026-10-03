import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useTranslation } from "react-i18next";

interface AccountDeletionRequest {
  id: string;
  requested_at: string;
  scheduled_deletion_at: string;
  reason: string | null;
  status: string;
}

interface RequestDeletionParams {
  reason?: string;
  feedback?: string;
}

interface DeletionResponse {
  success: boolean;
  request_id: string;
  scheduled_deletion_at: string;
  message: string;
}

/**
 * Hook for managing account deletion requests.
 * Provides functionality to request, cancel, and check deletion status.
 *
 * @example
 * const { pendingRequest, requestDeletion, cancelDeletion } = useAccountDeletion();
 */
export function useAccountDeletion() {
  const { user } = useSession();

  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Get pending deletion request (only for authenticated users)
  const {
    data: pendingRequest,
    isLoading,
    error,
  } = useQuery<AccountDeletionRequest | null>({
    queryKey: ["account-deletion-request", user?.id],
    queryFn: async () => {
      const { data, error } = await aisha.rpc(
        "get_my_account_deletion_request"
      );

      if (error) throw new Error(error.message);

      // RPC returns array, get first item
      if (Array.isArray(data) && data.length > 0) {
        return data[0] as AccountDeletionRequest;
      }

      return null;
    },
    enabled: !!user?.id,
  });

  // Request account deletion
  const requestDeletionMutation = useMutation({
    mutationFn: async (params: RequestDeletionParams) => {
      const { data, error } = await aisha.rpc("request_account_deletion", {
        p_feedback: params.feedback ?? undefined,
        p_reason: params.reason ?? undefined,
      });

      if (error) throw new Error(error.message);
      return data as unknown as DeletionResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-deletion-request"] });
      toast.success(t("legal.accountDeletion.requestSubmitted.title"), {
        description: t("legal.accountDeletion.requestSubmitted.message"),
      });
    },
    onError: () => {
      toast.error(t("legal.accountDeletion.error.title"), {
        description: t("legal.accountDeletion.error.message"),
      });
    },
  });

  // Cancel account deletion
  const cancelDeletionMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await aisha.rpc("cancel_account_deletion");

      if (error) throw new Error(error.message);
      return data as unknown as DeletionResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-deletion-request"] });
      toast.success(t("common.success"), {
        description: t("legal.accountDeletion.buttons.cancel"),
      });
    },
    onError: () => {
      toast.error(t("common.error"), {
        description: t("legal.accountDeletion.error.message"),
      });
    },
  });

  return {
    pendingRequest,
    isLoading,
    error,
    requestDeletion: requestDeletionMutation.mutateAsync,
    isRequesting: requestDeletionMutation.isPending,
    cancelDeletion: cancelDeletionMutation.mutateAsync,
    isCancelling: cancelDeletionMutation.isPending,
  };
}
