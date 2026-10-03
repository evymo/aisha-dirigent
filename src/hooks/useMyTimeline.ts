/**
 * Member Timeline Hook
 * 
 * Data layer for member health timeline (StoryLoop from member perspective).
 * Members can view their own timeline and add entries to their stories.
 * All data access through audited RPC functions.
 * 
 * @module useMyTimeline
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aisha } from '@/integrations/db/client';
import { useSession } from './useSession';
import { safeError } from '@/lib/security/safeLogger';
import { z } from 'zod';

// =====================================================
// Schemas
// =====================================================

/**
 * Timeline entry schema
 */
export const TimelineEntrySchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid(),
  entry_type: z.string(),
  content: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  is_pinned: z.boolean(),
  document_id: z.string().uuid().nullable(),
  occurred_at: z.string().nullable(),
  created_at: z.string(),
  story_title: z.string().nullable(),
  partner_name: z.string().nullable(),
});

/**
 * Timeline story summary schema
 */
export const TimelineStorySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  last_activity_at: z.string().nullable(),
  partner_name: z.string().nullable(),
});

/**
 * Full timeline response schema
 */
export const TimelineResponseSchema = z.object({
  user_id: z.string().uuid(),
  total_count: z.number(),
  entries: z.array(TimelineEntrySchema),
  stories: z.array(TimelineStorySchema),
});

// =====================================================
// Types
// =====================================================

export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type TimelineStory = z.infer<typeof TimelineStorySchema>;
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

/**
 * Entry types that members can add to their timeline
 */
export const MEMBER_ALLOWED_ENTRY_TYPES = ['note', 'health_event', 'document', 'message', 'lab_result', 'blood_analysis', 'product_log', 'health_log'] as const;
export type MemberEntryType = typeof MEMBER_ALLOWED_ENTRY_TYPES[number];

/**
 * System-generated entry types (created by triggers)
 */
export const SYSTEM_ENTRY_TYPES = [
  'system_check_in',
  'system_document',
  'system_dosing',
  'system_registration',
  'system_health_sync',
  'system_lab_result',
  'system_order',
  'system_payment',
  'system_questionnaire'
] as const;
export type SystemEntryType = typeof SYSTEM_ENTRY_TYPES[number];

/**
 * All entry types for filtering
 */
export const ALL_ENTRY_TYPES = [...MEMBER_ALLOWED_ENTRY_TYPES, ...SYSTEM_ENTRY_TYPES] as const;
export type AllEntryType = typeof ALL_ENTRY_TYPES[number];

/**
 * Request to add a new timeline entry
 */
export interface AddTimelineEntryRequest {
  storyId: string;
  entryType: MemberEntryType;
  content: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  documentId?: string;
}

// =====================================================
// Query Keys
// =====================================================

export const timelineKeys = {
  all: ['member-timeline'] as const,
  timeline: (filters?: {
    entryTypes?: string[];
    dateFrom?: string;
    dateTo?: string;
  }) => [...timelineKeys.all, 'entries', filters] as const,
  entry: (id: string) => [...timelineKeys.all, 'entry', id] as const,
};

// =====================================================
// Helpers
// =====================================================

/**
 * Check if a content string is a system i18n key (e.g. "timeline.order_created")
 */
export function isSystemContentKey(content: string | null): boolean {
  return content != null && content.startsWith('timeline.');
}

/**
 * Resolve system content key to localized text.
 * If content is a system i18n key, look it up in myTimeline.systemContent.
 * Otherwise return the content as-is.
 */
export function resolveSystemContent(
  content: string | null,
  t: (key: string) => string,
  metadata?: Record<string, unknown> | null,
): string {
  if (!content) return '';

  if (isSystemContentKey(content)) {
    const i18nKey = `myTimeline.systemContent.${content}`;
    const translated = t(i18nKey);

    // If translation found and is different from key, use it
    if (translated !== i18nKey) {
      // Append order_number or study_title from metadata if available
      if (metadata?.order_number) {
        return `${translated} #${String(metadata.order_number)}`;
      }
      if (metadata?.study_title) {
        return `${translated}: ${String(metadata.study_title)}`;
      }
      if (metadata?.check_in_number) {
        return `${translated} #${String(metadata.check_in_number)}`;
      }
      if (metadata?.questionnaire_title) {
        return `${translated}: ${String(metadata.questionnaire_title)}`;
      }
      if (metadata?.product_name) {
        return `${translated}: ${String(metadata.product_name)}`;
      }
      return translated;
    }
  }

  return content;
}

// =====================================================
// Hooks
// =====================================================

/**
 * Fetch member's own timeline
 * 
 * Returns all entries across all stories where the current user is the user.
 * Supports filtering by entry type and date range.
 * 
 * @param filters - Optional filters for the timeline query
 * @returns Timeline data with entries and story summaries
 * 
 * @example
 * ```tsx
 * const { data, isLoading } = useMyTimeline({
 *   entryTypes: ['note', 'health_event'],
 *   dateFrom: '2026-01-01',
 * });
 * ```
 */
export function useMyTimeline(filters?: {
  entryTypes?: string[] | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  offset?: number;
}) {
  const { user } = useSession();

  return useQuery({
    queryKey: timelineKeys.timeline({
      entryTypes: filters?.entryTypes ?? undefined,
      dateFrom: filters?.dateFrom ?? undefined,
      dateTo: filters?.dateTo ?? undefined,
    }),
    queryFn: async (): Promise<TimelineResponse | null> => {
      const { data, error } = await aisha.rpc('get_my_timeline_audited', {
        p_date_from: filters?.dateFrom ?? undefined,
        p_date_to: filters?.dateTo ?? undefined,
        p_entry_types: filters?.entryTypes ?? undefined,
        p_limit: filters?.limit ?? 50,
        p_offset: filters?.offset ?? 0,
      });

      if (error) {
        safeError('timeline.useMyTimeline', error);
        throw new Error(error.message);
      }

      // Handle null response
      if (!data) {
        return {
          user_id: user?.id ?? '',
          total_count: 0,
          entries: [],
          stories: [],
        };
      }

      // Validate response
      const validated = TimelineResponseSchema.safeParse(data);
      if (!validated.success) {
        safeError('timeline.useMyTimeline.validation', validated.error);
        return {
          user_id: user?.id ?? '',
          total_count: 0,
          entries: [],
          stories: [],
        };
      }

      return validated.data;
    },
    enabled: !!user?.id,
  });
}

/**
 * Add entry to member's timeline
 * 
 * Allows members to add notes, health events, documents, or messages
 * to their own stories. Supports backdating via occurredAt.
 * 
 * @returns Mutation for adding timeline entries
 * 
 * @example
 * ```tsx
 * const { mutate } = useAddTimelineEntry();
 * 
 * mutate({
 *   storyId: 'uuid',
 *   entryType: 'note',
 *   content: 'Dnes jsem se cítil lépe.',
 *   occurredAt: '2026-01-20T10:00:00Z', // optional backdating
 * });
 * ```
 */
export function useAddTimelineEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: AddTimelineEntryRequest) => {
      const { data, error } = await aisha.rpc('add_timeline_entry_audited', {
        p_content: request.content,
        p_document_id: request.documentId ?? undefined,
        p_entry_type: request.entryType,
        p_metadata: request.metadata ? JSON.parse(JSON.stringify(request.metadata)) : undefined,
        p_occurred_at: request.occurredAt ?? undefined,
        p_story_id: request.storyId,
      });

      if (error) {
        safeError('timeline.useAddTimelineEntry', error);
        throw new Error(error.message);
      }

      return data as { success: boolean; entry_id: string; story_id: string };
    },
    onSuccess: () => {
      // Invalidate timeline queries to refetch
      queryClient.invalidateQueries({ queryKey: timelineKeys.all });
    },
  });
}

/**
 * Get member's stories summary
 * 
 * Returns list of stories where the current user is the user,
 * useful for story selection when adding entries.
 * 
 * @returns List of stories with summary info
 */
export function useMyStories() {
  const { user } = useSession();

  return useQuery({
    queryKey: [...timelineKeys.all, 'stories'],
    queryFn: async (): Promise<TimelineStory[]> => {
      // Use the timeline endpoint to get stories only
      const { data, error } = await aisha.rpc('get_my_timeline_audited', {
        p_date_from: undefined,
        p_date_to: undefined,
        p_entry_types: undefined,
        p_limit: 1, // We only need stories, not entries
        p_offset: 0,
      });

      if (error) {
        safeError('timeline.useMyStories', error);
        throw new Error(error.message);
      }

      const validated = TimelineResponseSchema.safeParse(data);
      if (!validated.success) {
        safeError('timeline.useMyStories.validation', validated.error);
        return [];
      }

      return validated.data.stories;
    },
    enabled: !!user?.id,
  });
}

/**
 * Check if member has any timeline data
 * 
 * @returns Boolean indicating if user has timeline entries
 */
export function useHasTimeline() {
  const { data, isLoading } = useMyTimeline({ limit: 1 });

  return {
    hasTimeline: (data?.total_count ?? 0) > 0 || (data?.stories.length ?? 0) > 0,
    isLoading,
  };
}
