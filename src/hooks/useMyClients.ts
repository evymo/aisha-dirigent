import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  parseRpcArray,
  parseRpcResponse,
  assignedClientSchema,
  clientDetailsSchema,
  type AssignedClientValidated,
  type ClientDetailsValidated,
} from "@/lib/validation/rpcSchemas";

export type { AssignedClientValidated, ClientDetailsValidated };

/**
 * Hook to fetch assigned clients for the current partner
 */
export function useMyAssignedClients() {
  return useQuery({
    queryKey: ["partner", "my-clients"],
    queryFn: async () => {
      const { data, error } = await aisha.rpc("get_my_assigned_clients");

      if (error) {
        safeError("partner.myClients.fetchFailed", error);
        throw new Error(error.message);
      }

      return parseRpcArray(assignedClientSchema, data, "get_my_assigned_clients");
    },
  });
}

/**
 * Hook to fetch client onboarding details
 */
export function useClientDetails(userId: string | null) {
  return useQuery({
    queryKey: ["partner", "client-details", userId],
    queryFn: async () => {
      if (!userId) return null;

      const { data, error } = await aisha.rpc("get_client_onboarding_details", {
        p_user_id: userId,
      });

      if (error) {
        safeError("partner.myClients.detailsFetchFailed", error);
        throw new Error(error.message);
      }

      return parseRpcResponse(clientDetailsSchema, data, "get_client_onboarding_details");
    },
    enabled: !!userId,
  });
}

/**
 * Hook to request data sharing consent from a client
 */
export function useRequestConsentFromClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, message }: { userId: string; message: string }) => {
      const { error } = await aisha.rpc("request_data_sharing_consent", {
        p_message: message
,
        p_user_id: userId
    });

      if (error) {
        safeError("partner.myClients.requestConsentFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner", "my-clients"] });
    },
  });
}

/**
 * Hook to relinquish data access to a client
 */
export function useRelinquishDataAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      const { error } = await aisha.rpc("partner_relinquish_data_access", {
        p_reason: reason
,
        p_user_id: userId
    });

      if (error) {
        safeError("partner.myClients.relinquishAccessFailed", error);
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner", "my-clients"] });
    },
  });
}
