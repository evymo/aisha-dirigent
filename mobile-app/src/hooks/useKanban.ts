/**
 * Kanban board hooks — the auto-populated story board.
 *
 * Backed by three RPCs (all verified in DB SoT):
 *   - `kanban_stories_view(p_partner_id)` — read side; one row per visible story
 *     with joined workflow_statuses metadata + latest ai_run + last trace event.
 *     Rows self-describe their column (status_sort_order / label / color), so the
 *     board builds swimlanes with no separate columns query.
 *   - `update_story_status_audited(p_story_id, p_status)` — write side (drag/move);
 *     transition validation + role gating live in the RPC body.
 *   - `get_allowed_kanban_transitions(p_story_id)` — legal next statuses for a story.
 *
 * Visibility is decided server-side (admin/staff OR stack-default OR participant) —
 * the board renders exactly what the caller is allowed to see.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/config/api";
import { enqueueMutation, isNetworkConnected } from "@/services/offline";
import { kanbanStorySchema, storyTimelineEventSchema } from "@/types/schemas";
import { safeError } from "@/lib/security/safeLogger";
import type { KanbanStory, StoryTimelineEvent } from "@/types/schemas";

function parseKanbanRows(data: unknown): KanbanStory[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<KanbanStory[]>((acc, item) => {
    const result = kanbanStorySchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

/** One swimlane (kanban column) with its stories. */
export interface KanbanColumn {
  status: string;
  labelKey: string | null;
  color: string | null;
  isTerminal: boolean;
  sortOrder: number;
  stories: KanbanStory[];
}

/**
 * Group flat kanban rows into ordered swimlanes. Pure (exported for tests).
 * Columns are ordered by `status_sort_order` (nulls last); stories within a
 * column by `last_activity_at` desc. Only columns that contain stories appear.
 */
export function groupIntoColumns(rows: KanbanStory[]): KanbanColumn[] {
  const byStatus = new Map<string, KanbanColumn>();
  for (const row of rows) {
    let col = byStatus.get(row.status);
    if (!col) {
      col = {
        status: row.status,
        labelKey: row.status_label_i18n_key,
        color: row.status_swimlane_color,
        isTerminal: row.status_is_terminal,
        sortOrder: row.status_sort_order ?? 9999,
        stories: [],
      };
      byStatus.set(row.status, col);
    }
    col.stories.push(row);
  }
  const columns = Array.from(byStatus.values());
  for (const col of columns) {
    col.stories.sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at));
  }
  columns.sort((a, b) => a.sortOrder - b.sortOrder || a.status.localeCompare(b.status));
  return columns;
}

/** Live kanban story list grouped into swimlanes. */
export function useKanbanBoard(enabled = true) {
  const query = useQuery<KanbanStory[]>({
    queryKey: ["kanban-stories"],
    queryFn: async () => {
      const { data, error } = await api.rpc("kanban_stories_view", {});
      if (error) {
        safeError("useKanbanBoard.fetch", error);
        throw error;
      }
      return parseKanbanRows(data);
    },
    enabled,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const columns = useMemo(() => groupIntoColumns(query.data ?? []), [query.data]);
  return { ...query, columns };
}

export interface AllowedTransition {
  to_status: string;
  requires_role: string | null;
}

export async function fetchAllowedTransitions(storyId: string): Promise<AllowedTransition[]> {
  const { data, error } = await api.rpc("get_allowed_kanban_transitions", {
    p_story_id: storyId,
  });
  if (error) {
    safeError("fetchAllowedTransitions.fetch", error);
    throw error;
  }
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = row as { to_status?: unknown; requires_role?: unknown };
    return typeof r.to_status === "string"
      ? [{ to_status: r.to_status, requires_role: typeof r.requires_role === "string" ? r.requires_role : null }]
      : [];
  });
}

/** Legal next statuses for a story (excludes role-gated moves the caller can't make). */
export function useAllowedTransitions(storyId: string | undefined) {
  return useQuery<AllowedTransition[]>({
    queryKey: ["kanban-transitions", storyId],
    queryFn: () => fetchAllowedTransitions(storyId!),
    enabled: !!storyId,
    staleTime: 60 * 1000,
  });
}

/** Move a story to a new kanban status (server validates the transition). */
export function useMoveStoryStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ storyId, toStatus }: { storyId: string; toStatus: string }) => {
      if (!(await isNetworkConnected())) {
        await enqueueMutation(
          `transition_status:${storyId}:${toStatus}:${Date.now()}`,
          { storyId, toStatus },
          "transition_status",
        );
        return { queued: true };
      }
      const { data, error } = await api.rpc("update_story_status_audited", {
        p_status: toStatus,
        p_story_id: storyId,
      });
      if (error) {
        safeError("useMoveStoryStatus.move", error);
        throw error;
      }
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["kanban-stories"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-transitions", variables.storyId] });
      queryClient.invalidateQueries({ queryKey: ["project-detail", variables.storyId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

function parseTimeline(data: unknown): StoryTimelineEvent[] {
  if (!Array.isArray(data)) return [];
  return data.reduce<StoryTimelineEvent[]>((acc, item) => {
    const result = storyTimelineEventSchema.safeParse(item);
    if (result.success) acc.push(result.data);
    return acc;
  }, []);
}

/**
 * Auto-populated story timeline (agent runs, deploys, blue/green switches).
 * Empty for stories with no agent/deploy activity (e.g. plain member diaries).
 */
export function useStoryTimeline(storyId: string | undefined, limit = 50) {
  return useQuery<StoryTimelineEvent[]>({
    queryKey: ["story-timeline", storyId, limit],
    queryFn: async () => {
      const { data, error } = await api.rpc("story_timeline", {
        p_limit: limit,
        p_story_id: storyId!,
      });
      if (error) {
        safeError("useStoryTimeline.fetch", error);
        throw error;
      }
      return parseTimeline(data);
    },
    enabled: !!storyId,
    staleTime: 30 * 1000,
  });
}
