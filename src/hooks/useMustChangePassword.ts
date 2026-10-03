import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "@/hooks/useSession";

/**
 * Hook to check if user must change their password
 * 
 * This is used for:
 * 1. Default admin accounts that need password change
 * 2. Accounts flagged after security incidents
 * 3. Enforcing password rotation policies
 */
export function useMustChangePassword() {
  const { user } = useSession();

  const { data: mustChangePassword, isLoading } = useQuery({
    queryKey: ["must-change-password", user?.id],
    queryFn: async () => {
      if (!user) return false;

      const { data, error } = await aisha.rpc("rpc_check_must_change_password");
      
      if (error) {
        // If RPC doesn't exist yet, check user metadata directly
        const isDefaultAdmin = user.raw_claims["must_change_password"] === true;
        return isDefaultAdmin;
      }
      
      return data === true;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    mustChangePassword: mustChangePassword ?? false,
    isLoading,
  };
}

/**
 * Hook to clear the must_change_password flag after password is changed.
 *
 * @returns Mutation object for clearing the flag.
 */
export function useClearMustChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await aisha.rpc("rpc_clear_must_change_password");
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["must-change-password"] });
    },
  });
}
