import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { profileCompletenessSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { ProfileCompleteness } from "@/types/schemas";

export function useProfileCompleteness(userId: string | undefined) {
  return useQuery<ProfileCompleteness>({
    queryKey: ["profile-completeness", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_profile_completeness");
      if (error) {
        safeError("useProfileCompleteness.fetch", error);
        throw error;
      }
      return profileCompletenessSchema.parse(data);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
