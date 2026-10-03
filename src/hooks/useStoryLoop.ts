/**
 * StoryLoop Hook
 * 
 * Data layer for StoryLoop partner workspace.
 * All data access through audited RPC functions.
 */

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { useSession } from './useSession';
import { safeError } from '@/lib/security/safeLogger';
import {
  StoryListItemSchema,
  StoryDetailSchema,
  StoryStatsSchema,
  UpcomingReminderSchema,
  LabelStatsSchema,
  StoryAiContextSchema,
  type StoryListItem,
  type StoryDetail,
  type StoryStats,
  type UpcomingReminder,
  type LabelStats,
  type StoryAiContext,
  type CreateStoryEntryRequest,
} from '@/schemas/storyLoopSchemas';
import { z } from 'zod';

const storyAttachableDocumentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  file_name: z.string(),
  file_path: z.string(),
  mime_type: z.string().nullable(),
  category: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  document_date: z.string().nullable(),
  created_at: z.string(),
});

export type StoryAttachableDocument = z.infer<typeof storyAttachableDocumentSchema>;

// =====================================================
// Query Keys
// =====================================================

export const storyLoopKeys = {
  all: ['storyloop'] as const,
  stories: (filters?: { status?: string; search?: string; labels?: string[] }) =>
    [...storyLoopKeys.all, 'stories', filters] as const,
  story: (id: string) => [...storyLoopKeys.all, 'story', id] as const,
  stats: () => [...storyLoopKeys.all, 'stats'] as const,
  reminders: () => [...storyLoopKeys.all, 'reminders'] as const,
  labels: () => [...storyLoopKeys.all, 'labels'] as const,
  aiContext: (storyId: string) => [...storyLoopKeys.all, 'ai-context', storyId] as const,
  attachableDocuments: (storyId: string | null) => [...storyLoopKeys.all, 'attachable-documents', storyId] as const,
};

// =====================================================
// Hooks
// =====================================================

/**
 * Fetch stories list with filters
 */
export function useStories(filters?: {
  status?: string | null;
  search?: string | null;
  labels?: string[] | null;
  limit?: number;
  offset?: number;
}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: storyLoopKeys.stories({ 
      status: filters?.status ?? undefined, 
      search: filters?.search ?? undefined, 
      labels: filters?.labels ?? undefined 
    }),
    queryFn: async (): Promise<StoryListItem[]> => {
      const { data, error } = await aisha.rpc('get_my_stories_audited', {
        p_labels: filters?.labels ?? undefined,
        p_limit: filters?.limit ?? 50,
        p_offset: filters?.offset ?? 0,
        p_search: filters?.search ?? undefined,
        p_status: filters?.status ?? undefined,
      });

      if (error) {
        safeError('storyloop.useStories', error);
        throw new Error(error.message);
      }

      // Validate response
      const validated = z.array(StoryListItemSchema).safeParse(data);
      if (!validated.success) {
        safeError('storyloop.useStories.validation', validated.error);
        return [];
      }

      return validated.data;
    },
    enabled: options?.enabled ?? true,
  });
}

/** Default page size for infinite story lists. */
const STORIES_PAGE_SIZE = 30;

/**
 * Infinite-scroll variant of useStories.
 *
 * Returns a paginated `useInfiniteQuery` result using offset-based pagination.
 * Intended for the scrollable story list. Use `useStories` for
 * one-shot flat loads (e.g. dialogs / dropdowns).
 *
 * @example
 * const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteStories({ status: 'inbox' });
 * const stories = data?.pages.flatMap(p => p.stories) ?? [];
 */
export function useInfiniteStories(filters?: {
  status?: string | null;
  search?: string | null;
  labels?: string[] | null;
  pageSize?: number;
}, options?: { enabled?: boolean }) {
  const limit = filters?.pageSize ?? STORIES_PAGE_SIZE;

  return useInfiniteQuery({
    queryKey: [...storyLoopKeys.stories({
      status: filters?.status ?? undefined,
      search: filters?.search ?? undefined,
      labels: filters?.labels ?? undefined,
    }), 'infinite'] as const,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<{ stories: StoryListItem[]; nextOffset: number | null }> => {
      const offset = pageParam;
      const { data, error } = await aisha.rpc('get_my_stories_audited', {
        p_labels: filters?.labels ?? undefined,
        p_limit: limit,
        p_offset: offset,
        p_search: filters?.search ?? undefined,
        p_status: filters?.status ?? undefined,
      });

      if (error) {
        safeError('storyloop.useInfiniteStories', error);
        throw new Error(error.message);
      }

      const validated = z.array(StoryListItemSchema).safeParse(data);
      if (!validated.success) {
        safeError('storyloop.useInfiniteStories.validation', validated.error);
        return { stories: [], nextOffset: null };
      }

      return {
        stories: validated.data,
        nextOffset: validated.data.length === limit ? offset + limit : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Fetch single story detail
 */
export function useStoryDetail(storyId: string | null) {
  return useQuery({
    queryKey: storyLoopKeys.story(storyId ?? ''),
    queryFn: async (): Promise<StoryDetail | null> => {
      if (!storyId) return null;

      const { data, error } = await aisha.rpc('get_story_detail_audited', {
        p_story_id: storyId,
      });

      if (error) {
        safeError('storyloop.useStoryDetail', error);
        throw new Error(error.message);
      }

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return null;
      }

      // RPC returns array, take first item
      const row = Array.isArray(data) ? data[0] : data;
      
      const validated = StoryDetailSchema.safeParse(row);
      if (!validated.success) {
        safeError('storyloop.useStoryDetail.validation', validated.error);
        return null;
      }

      return validated.data;
    },
    enabled: !!storyId,
  });
}

/**
 * Fetch story stats (counts by status)
 */
export function useStoryStats(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: storyLoopKeys.stats(),
    queryFn: async (): Promise<StoryStats> => {
      const { data, error } = await aisha.rpc('get_partner_story_stats');

      if (error) {
        safeError('storyloop.useStoryStats', error);
        throw new Error(error.message);
      }

      const row = Array.isArray(data) ? data[0] : data;
      
      const validated = StoryStatsSchema.safeParse(row);
      if (!validated.success) {
        safeError('storyloop.useStoryStats.validation', validated.error);
        return {
          active_count: 0,
          inbox_count: 0,
          in_progress_count: 0,
          scheduled_count: 0,
          archived_count: 0,
          starred_count: 0,
          unread_total: 0,
        };
      }

      return validated.data;
    },
    enabled: options?.enabled ?? true,
  });
}

/**
 * Fetch upcoming reminders
 */
export function useUpcomingReminders(limit = 10, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: storyLoopKeys.reminders(),
    queryFn: async (): Promise<UpcomingReminder[]> => {
      const { data, error } = await aisha.rpc('get_my_upcoming_reminders_audited', {
        p_limit: limit,
      });

      if (error) {
        safeError('storyloop.useUpcomingReminders', error);
        throw new Error(error.message);
      }

      const validated = z.array(UpcomingReminderSchema).safeParse(data);
      if (!validated.success) {
        safeError('storyloop.useUpcomingReminders.validation', validated.error);
        return [];
      }

      return validated.data;
    },
    enabled: options?.enabled ?? true,
  });
}

/**
 * Fetch all labels used by partner
 */
export function useStoryLabels(options?: { enabled?: boolean }) {
  const { user } = useSession();
  
  return useQuery({
    queryKey: [...storyLoopKeys.labels(), user?.id],
    queryFn: async (): Promise<LabelStats[]> => {
      if (!user?.id) return [];
      
      const { data, error } = await aisha.rpc('get_my_story_labels_audited');

      if (error) {
        safeError('storyloop.useStoryLabels', error);
        throw new Error(error.message);
      }

      const validated = z.array(LabelStatsSchema).safeParse(data);
      if (!validated.success) {
        safeError('storyloop.useStoryLabels.validation', validated.error);
        return [];
      }

      return validated.data;
    },
    enabled: (options?.enabled ?? true) && !!user?.id,
  });
}

/**
 * Fetch story context for AI consultation
 */
export function useStoryAiContext(storyId: string | null) {
  return useQuery({
    queryKey: storyLoopKeys.aiContext(storyId ?? ''),
    queryFn: async (): Promise<StoryAiContext | null> => {
      if (!storyId) return null;

      const { data, error } = await aisha.rpc('get_story_context_for_ai_audited', {
        p_story_id: storyId,
      });

      if (error) {
        safeError('storyloop.useStoryAiContext', error);
        throw new Error(error.message);
      }

      const validated = StoryAiContextSchema.safeParse(data);
      if (!validated.success) {
        safeError('storyloop.useStoryAiContext.validation', validated.error);
        return null;
      }

      return validated.data;
    },
    enabled: !!storyId,
  });
}

/**
 * Fetch partner-visible member documents that can be attached to a story entry.
 * Access is enforced server-side against story ownership + sharing permissions.
 */
export function useStoryAttachableDocuments(storyId: string | null) {
  return useQuery({
    queryKey: storyLoopKeys.attachableDocuments(storyId),
    queryFn: async (): Promise<StoryAttachableDocument[]> => {
      if (!storyId) return [];

      const { data, error } = await aisha.rpc('get_story_attachable_documents_audited', {
        p_limit: 200,
        p_story_id: storyId,
      });

      if (error) {
        safeError('storyloop.useStoryAttachableDocuments', error);
        throw new Error(error.message);
      }

      const validated = z.array(storyAttachableDocumentSchema).safeParse(data);
      if (!validated.success) {
        safeError('storyloop.useStoryAttachableDocuments.validation', validated.error);
        return [];
      }

      return validated.data;
    },
    enabled: !!storyId,
  });
}

// =====================================================
// Mutations
// =====================================================

/**
 * Create new story
 */
export function useCreateStory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      user_id: string;
      study_id?: string;
      title?: string;
    }) => {
      const { data, error } = await aisha.rpc('create_story_audited', {
        p_study_id: params.study_id,
        p_title: params.title,
      
        p_user_id: params.user_id,});

      if (error) {
        safeError('storyloop.createStory', error);
        throw new Error(error.message);
      }

      return data as string; // Returns story ID
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stories() });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stats() });
    },
  });
}

/**
 * Create story entry
 */
export function useCreateStoryEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateStoryEntryRequest) => {
      const { data, error } = await aisha.rpc('create_story_entry_audited', {
        p_content: params.content,
        p_document_id: params.document_id,
        p_entry_type: params.entry_type,
        p_is_internal: params.is_internal ?? false,
        p_metadata: JSON.parse(JSON.stringify(params.metadata ?? {})),
        p_parent_id: params.parent_id,
        p_story_id: params.story_id,
      });

      if (error) {
        safeError('storyloop.createStoryEntry', error);
        throw new Error(error.message);
      }

      return data as string; // Returns entry ID
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(variables.story_id) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stories() });
    },
  });
}

/**
 * Update story status
 */
export function useUpdateStoryStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { story_id: string; status: string }) => {
      const { data, error } = await aisha.rpc('update_story_status_audited', {
        p_status: params.status,
        p_story_id: params.story_id,
      });

      if (error) {
        safeError('storyloop.updateStoryStatus', error);
        throw new Error(error.message);
      }

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(variables.story_id) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stories() });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stats() });
    },
  });
}

/**
 * Toggle story star
 */
export function useToggleStoryStar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (storyId: string) => {
      const { data, error } = await aisha.rpc('toggle_story_star_audited', {
        p_story_id: storyId,
      });

      if (error) {
        safeError('storyloop.toggleStoryStar', error);
        throw new Error(error.message);
      }

      return data as boolean;
    },
    onSuccess: (_, storyId) => {
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(storyId) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stories() });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.stats() });
    },
  });
}

/**
 * Create story reminder
 */
export function useCreateStoryReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      story_id: string;
      remind_at: string;
      message?: string;
    }) => {
      const { data, error } = await aisha.rpc('create_story_reminder_audited', {
        p_message: params.message,
        p_remind_at: params.remind_at,
        p_story_id: params.story_id,
      });

      if (error) {
        safeError('storyloop.createStoryReminder', error);
        throw new Error(error.message);
      }

      return data as string;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.story(variables.story_id) });
      queryClient.invalidateQueries({ queryKey: storyLoopKeys.reminders() });
    },
  });
}
