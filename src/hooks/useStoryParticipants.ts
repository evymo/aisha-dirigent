/**
 * Story Participants Hook
 *
 * Manages story collaboration: list, add, and remove participants.
 * All data access through audited RPC functions.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { safeError } from '@/lib/security/safeLogger';
import {
  StoryParticipantSchema,
  type StoryParticipant,
} from '@/schemas/storyLoopSchemas';
import { storyLoopKeys } from './useStoryLoop';
import { z } from 'zod';

// =====================================================
// Query Keys
// =====================================================

export const storyParticipantKeys = {
  all: [...storyLoopKeys.all, 'participants'] as const,
  list: (storyId: string) => [...storyParticipantKeys.all, storyId] as const,
};

// =====================================================
// Hooks
// =====================================================

/**
 * Fetch participants for a story.
 *
 * @param storyId - The story to fetch participants for.
 * @returns Query result with participant list.
 */
export function useStoryParticipants(storyId: string | null) {
  return useQuery({
    queryKey: storyParticipantKeys.list(storyId ?? ''),
    queryFn: async (): Promise<StoryParticipant[]> => {
      if (!storyId) return [];

      const { data, error } = await aisha.rpc('get_story_participants_audited', {
        p_story_id: storyId,
      });

      if (error) {
        safeError('storyloop.useStoryParticipants', error);
        throw new Error(error.message);
      }

      const validated = z.array(StoryParticipantSchema).safeParse(data);
      if (!validated.success) {
        safeError('storyloop.useStoryParticipants.validation', validated.error);
        return [];
      }

      return validated.data;
    },
    enabled: !!storyId,
  });
}

/**
 * Add a participant to a story (invite a certified partner/guild expert).
 *
 * @returns Mutation for adding a participant.
 */
export function useAddStoryParticipant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      story_id: string;
      target_user_id: string;
      role?: string;
    }) => {
      const { data, error } = await aisha.rpc('add_story_participant_audited', {
        p_role: params.role ?? 'guild_expert',
        p_story_id: params.story_id,
        p_target_user_id: params.target_user_id,
      });

      if (error) {
        safeError('storyloop.addStoryParticipant', error);
        throw new Error(error.message);
      }

      return data as { success: boolean; story_id: string; target_user_id: string; role: string };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: storyParticipantKeys.list(variables.story_id) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(variables.story_id) });
    },
  });
}

/**
 * Remove a participant from a story (or leave a story).
 *
 * @returns Mutation for removing a participant.
 */
export function useRemoveStoryParticipant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      story_id: string;
      target_user_id: string;
    }) => {
      const { data, error } = await aisha.rpc('remove_story_participant_audited', {
        p_story_id: params.story_id,
        p_target_user_id: params.target_user_id,
      });

      if (error) {
        safeError('storyloop.removeStoryParticipant', error);
        throw new Error(error.message);
      }

      return data as { success: boolean; story_id: string; removed_user_id: string };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: storyParticipantKeys.list(variables.story_id) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(variables.story_id) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stories() });
    },
  });
}
