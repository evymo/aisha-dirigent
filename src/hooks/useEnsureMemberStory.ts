/**
 * Hook: useEnsureMemberStory
 *
 * Ensures a member has at least one story when accessing their diary.
 * Calls `ensure_member_story_exists` RPC which is idempotent — returns
 * existing story ID or auto-creates one if eligible registration + consent exist.
 *
 * @module useEnsureMemberStory
 */

import { useQuery } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { useSession } from './useSession';
import { safeError } from '@/lib/security/safeLogger';

/**
 * Ensure member story exists on diary access.
 *
 * @returns storyId — the existing or newly created story ID, or null if no eligible registration
 *
 * @example
 * ```tsx
 * const { storyId, isLoading } = useEnsureMemberStory();
 * ```
 */
export function useEnsureMemberStory() {
  const { user, hasRole } = useSession();
  const isMember = hasRole('member');

  const query = useQuery({
    queryKey: ['member', 'ensure-story', user?.id],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await aisha.rpc('ensure_member_story_exists');

      if (error) {
        safeError('member.ensureStory', error);
        throw new Error(error.message);
      }

      return (data as string | null) ?? null;
    },
    enabled: !!user?.id && isMember,
    staleTime: 5 * 60_000, // 5 min — idempotent, no need to refetch often
    retry: 1,
  });

  return {
    storyId: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
