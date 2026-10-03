import { useQuery } from "@tanstack/react-query";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import {
  ChatAccessResponseSchema,
  type ChatAccessResponse,
} from "@/schemas/rpcResponseSchemas";
import { useSession } from "@/hooks/useSession";

/**
 * Fetches current user chat access level from RPC.
 *
 * @returns React Query result with parsed chat access response.
 */
export function useChatAccessLevel() {
  const { session } = useSession();

  return useQuery({
    queryKey: ["chat-access-level", session?.user?.id],
    queryFn: async (): Promise<ChatAccessResponse | null> => {
      const { data, error } = await aisha.rpc("get_chat_access_level");
      if (error) {
        throw new Error(error.message);
      }

      const parsed = ChatAccessResponseSchema.safeParse(data);
      if (!parsed.success) {
        safeError("useChatAccessLevel.validation", parsed.error);
        return null;
      }

      return parsed.data;
    },
    enabled: Boolean(session?.user?.id),
    staleTime: 60000,
  });
}
