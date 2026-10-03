/**
 * useEnsureStackDefaultStory — surface the singleton stack-default story id.
 *
 * On first call the RPC creates the row (idempotent on subsequent calls).
 * AdminStories renders this story at the top so operators can iterate on
 * the public default web exactly like any other story.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aisha } from "@/integrations/db/client";

const KEY = ["stack-default-story"] as const;

export function useStackDefaultStoryId() {
  return useQuery<string>({
    queryFn: async () => {
      const { data, error } = await aisha.rpc("ensure_stack_default_story");
      if (error) throw new Error(error.message);
      return typeof data === "string" ? data : String(data);
    },
    queryKey: KEY,
    staleTime: 60 * 60 * 1000,
  });
}

export function useEnsureStackDefaultStory() {
  const queryClient = useQueryClient();
  return useMutation<string, Error>({
    mutationFn: async () => {
      const { data, error } = await aisha.rpc("ensure_stack_default_story");
      if (error) throw new Error(error.message);
      return typeof data === "string" ? data : String(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}
