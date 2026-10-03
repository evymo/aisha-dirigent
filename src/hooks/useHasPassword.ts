import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";
import { useSession } from "./useSession";
import { safeError } from "@/lib/security/safeLogger";

/**
 * Hook to check if user has set a password.
 * Magic Link users initially don't have a password and must set one
 * before they can access sensitive data (health data).
 * 
 * compliance Compliance: Password is required for sensitive data access to ensure
 * the user has a second factor beyond email access.
 * 
 * NOTE: Uses check_user_has_password RPC which exists in DB.
 * The profiles.has_password column may not exist yet.
 */
export function useHasPassword() {
  const { user } = useSession();

  const query = useQuery({
    queryKey: ["has-password", user?.id],
    queryFn: async (): Promise<boolean> => {
      if (!user?.id) return false;

      try {
        // Try RPC first (more reliable, exists in DB)
        const { data, error } = await aisha
          .rpc("check_user_has_password", { p_user_id: user.id });

        if (!error && typeof data === "boolean") {
          return data;
        }

        // Fallback: assume false if RPC fails
        if (error) {
          safeError("useHasPassword.rpc", error);
        }
        return false;
      } catch (err) {
        safeError("useHasPassword.fetch", err);
        return false;
      }
    },
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    hasPassword: query.data ?? false,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/**
 * Hook to mark that user has set a password.
 * Called after successful password setup.
 * 
 * NOTE: Uses must_change_password column as proxy until has_password is added.
 */
export function useMarkPasswordSet() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not authenticated");

      // RPC-only: use mark_password_set function
      const { error } = await aisha.rpc("mark_password_set");

      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["has-password", user?.id] });
    },
    onError: (err) => {
      safeError("useMarkPasswordSet.update", err);
    },
  });
}
