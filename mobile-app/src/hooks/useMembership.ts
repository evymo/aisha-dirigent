import { useQuery } from "@tanstack/react-query";
import { api } from "@/config/api";
import { membershipSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { Membership } from "@/types/schemas";

export function useMembership(userId: string | undefined) {
  return useQuery<Membership>({
    queryKey: ["membership", userId],
    queryFn: async () => {
      const { data, error } = await api.rpc("get_my_membership");
      if (error) {
        safeError("useMembership.fetch", error);
        throw error;
      }
      return membershipSchema.parse(data);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
