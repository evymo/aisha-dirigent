/**
 * KanbanColumn — one workflow_status as a vertical column.
 *
 * Hosts SortableContext for drag-drop within the column AND a useDroppable
 * receiver so cards can be dropped from other columns.
 */
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { KanbanCard } from "./KanbanCard";
import type { KanbanStory } from "@/hooks/useKanbanBoard";
import type { AgentLiveSession } from "@/hooks/useAgentLiveSessions";

export interface KanbanColumnProps {
  /** Stable status code, e.g. "in_progress". Also the droppable id. */
  status: string;
  /** Optional swimlane color hint from workflow_statuses. */
  color?: string | null;
  /** Translated header label (already passed through t()). */
  label: string;
  stories: KanbanStory[];
  /** Live agent sessions keyed by story_id (lifted to the board). */
  sessionsByStory?: Map<string, AgentLiveSession>;
}

export function KanbanColumn({
  status,
  color,
  label,
  stories,
  sessionsByStory,
}: KanbanColumnProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { toStatus: status },
  });

  const colorClass = color
    ? `border-l-${color}-400` // Tailwind expects literal classnames; this is a best-effort hint
    : "border-l-muted";

  return (
    <div
      ref={setNodeRef}
      data-test={`kanban-column-${status}`}
      data-status={status}
      className={cn(
        "flex h-full min-h-[300px] w-72 shrink-0 flex-col rounded-md border bg-muted/30",
        "border-l-4",
        colorClass,
        isOver && "ring-2 ring-primary/60 bg-primary/5",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b bg-background/60 px-3 py-2">
        <h3 className="text-sm font-medium">{label}</h3>
        <Badge variant="outline" className="text-[10px]">
          {stories.length}
        </Badge>
      </header>

      <SortableContext
        items={stories.map((s) => s.story_id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          {stories.length === 0 ? (
            <div className="flex h-full items-center justify-center py-8 text-xs text-muted-foreground">
              {t("kanban.column.empty", "No stories here")}
            </div>
          ) : (
            stories.map((story) => (
              <KanbanCard
                key={story.story_id}
                story={story}
                liveSession={sessionsByStory?.get(story.story_id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
