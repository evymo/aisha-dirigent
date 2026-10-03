/**
 * KanbanBoard — orchestrates the drag-drop kanban surface.
 *
 * Wires:
 *   - useKanbanBoard()   — live data from kanban_stories_view
 *   - useWorkflowStatuses() — column definitions + sort order + labels
 *   - useMoveStoryStatus() — drag-end mutation
 *
 * Stack-default story is rendered as a separate pinned section at the
 * top so operators always see "the stack itself" before user stories.
 */
import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { useKanbanBoard, useMoveStoryStatus } from "@/hooks/useKanbanBoard";
import { useWorkflowStatuses } from "@/hooks/useWorkflowStatuses";
import { useAgentLiveSessions, type AgentLiveSession } from "@/hooks/useAgentLiveSessions";
import { safeError } from "@/lib/security/safeLogger";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import type { KanbanStory } from "@/hooks/useKanbanBoard";

export interface KanbanBoardProps {
  partnerId?: string | null;
}

export function KanbanBoard({ partnerId = null }: KanbanBoardProps) {
  const { t } = useTranslation();
  const board = useKanbanBoard({ partnerId });
  const statuses = useWorkflowStatuses();
  const moveStatus = useMoveStoryStatus();
  // Live agent sessions, matched to cards by story_id. One shared query +
  // realtime channel (react-query + useLiveTable refcount dedup), so every
  // card reads from the same source rather than fetching per-card. Built
  // inline (no manual useMemo — the React Compiler ratchet prefers it; the
  // map is cheap and children aren't memoized).
  const liveSessions = useAgentLiveSessions({ limit: 50 });
  const sessionsByStory = new Map<string, AgentLiveSession>();
  for (const s of liveSessions.data ?? []) {
    if (s.story_id) sessionsByStory.set(s.story_id, s);
  }
  const [activeStory, setActiveStory] = useState<KanbanStory | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { stackStories, userStories, byStatus } = useMemo(() => {
    const all = board.data ?? [];
    const stack: KanbanStory[] = [];
    const user: KanbanStory[] = [];
    const grouped = new Map<string, KanbanStory[]>();
    for (const story of all) {
      const bucket = grouped.get(story.status) ?? [];
      bucket.push(story);
      grouped.set(story.status, bucket);
      if (story.is_stack_default) stack.push(story);
      else user.push(story);
    }
    return { stackStories: stack, userStories: user, byStatus: grouped };
  }, [board.data]);

  if (board.isLoading || statuses.isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto p-4" data-test="kanban-loading">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[400px] w-72 shrink-0" />
        ))}
      </div>
    );
  }

  if (board.error || statuses.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {(board.error as Error | null)?.message ??
            (statuses.error as Error | null)?.message}
        </AlertDescription>
      </Alert>
    );
  }

  const columns = (statuses.data ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  function handleDragStart(event: DragStartEvent) {
    const found =
      board.data?.find((s) => s.story_id === event.active.id) ?? null;
    setActiveStory(found);
    setErrorMessage(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveStory(null);
    const { active, over } = event;
    if (!over) return;

    const overData = over.data.current as { toStatus?: string } | undefined;
    const activeData = active.data.current as
      | { storyId?: string; fromStatus?: string }
      | undefined;
    const toStatus = overData?.toStatus;
    const storyId = activeData?.storyId ?? String(active.id);
    const fromStatus = activeData?.fromStatus;

    if (!toStatus || !storyId || toStatus === fromStatus) return;

    try {
      await moveStatus.mutateAsync({ storyId, toStatus });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      safeError("KanbanBoard.handleDragEnd", err);
      setErrorMessage(msg);
    }
  }

  return (
    <div className="space-y-4" data-test="kanban-board">
      {errorMessage && (
        <Alert variant="destructive" data-test="kanban-move-error">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {moveStatus.isPending && (
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-test="kanban-move-pending"
        >
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          {t("kanban.moving", "Moving story…")}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveStory(null)}
      >
        {/* Stack-default lane (pinned) */}
        {stackStories.length > 0 && (
          <section
            className="space-y-2 rounded-lg border border-dashed bg-accent/10 p-3"
            data-test="kanban-lane-stack"
          >
            <h2 className="text-xs font-medium uppercase text-muted-foreground">
              {t("kanban.lane.stack", "Stack")}
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {columns.map((status) => (
                <KanbanColumn
                  key={`stack-${status.status}`}
                  status={status.status}
                  color={status.swimlane_color}
                  label={t(status.label_i18n_key)}
                  stories={(byStatus.get(status.status) ?? []).filter(
                    (s) => s.is_stack_default,
                  )}
                  sessionsByStory={sessionsByStory}
                />
              ))}
            </div>
          </section>
        )}

        {/* User stories lane */}
        <section className="space-y-2" data-test="kanban-lane-user">
          <h2 className="text-xs font-medium uppercase text-muted-foreground">
            {t("kanban.lane.userStories", "User stories")} ({userStories.length})
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {columns.map((status) => (
              <KanbanColumn
                key={`user-${status.status}`}
                status={status.status}
                color={status.swimlane_color}
                label={t(status.label_i18n_key)}
                stories={(byStatus.get(status.status) ?? []).filter(
                  (s) => !s.is_stack_default,
                )}
                sessionsByStory={sessionsByStory}
              />
            ))}
          </div>
        </section>

        <DragOverlay>
          {activeStory && (
            <KanbanCard
              story={activeStory}
              liveSession={sessionsByStory.get(activeStory.story_id)}
              isOverlay
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
