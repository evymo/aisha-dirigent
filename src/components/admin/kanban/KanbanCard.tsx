/**
 * KanbanCard — one story rendered as a draggable card.
 *
 * Uses @dnd-kit/sortable so the same component works as both the static
 * card inside a column AND the drag overlay (via `isOverlay` prop).
 *
 * Displays:
 *   - Title (story.title) + stack-default badge if applicable
 *   - Priority chip (when ≠ 'normal')
 *   - Current agent slug (if a run is active)
 *   - Branch (default_branch)
 *   - Last activity timestamp
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { GitBranch, Bot, Star, Clock, Package, DollarSign, Activity, Cpu } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SetBudgetDialog } from "@/components/admin/kanban/SetBudgetDialog";
import { formatUsd } from "@/components/admin/kanban/budgetFormat";
import type { KanbanStory } from "@/hooks/useKanbanBoard";
import type { AgentLiveSession } from "@/hooks/useAgentLiveSessions";

export interface KanbanCardProps {
  story: KanbanStory;
  /** Live agent session for this story (lifted to the board, matched by id). */
  liveSession?: AgentLiveSession;
  /** Render style for the floating overlay during drag. */
  isOverlay?: boolean;
}

/** Cold-start phase labels (mirror agent_phase_catalog axis=activity seed). */
const PHASE_LABELS: Record<string, string> = {
  idle: "idle",
  planning: "planning",
  tool_use: "tool use",
  reviewing: "reviewing",
  stopped: "stopped",
};

export function KanbanCard({ story, liveSession, isOverlay = false }: KanbanCardProps) {
  const { t } = useTranslation();
  const sortable = useSortable({
    id: story.story_id,
    data: { storyId: story.story_id, fromStatus: story.status },
  });

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      {...sortable.attributes}
      {...sortable.listeners}
      data-test={`kanban-card-${story.story_id}`}
      data-status={story.status}
      className={cn(
        "rounded-md border bg-card p-3 text-sm shadow-sm transition-shadow",
        "hover:shadow-md cursor-grab active:cursor-grabbing",
        story.is_stack_default && "border-primary/40 bg-primary/5",
        sortable.isDragging && !isOverlay && "opacity-30",
        isOverlay && "shadow-lg scale-[1.02]",
      )}
    >
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <Link
            to={`/admin/stories/${story.story_id}`}
            className="flex-1 truncate font-medium hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {story.is_stack_default && (
              <Package
                className="mr-1 inline size-3 text-primary"
                aria-hidden="true"
              />
            )}
            {story.title}
          </Link>
          {story.is_starred && (
            <Star
              className="size-3 shrink-0 text-amber-500"
              aria-hidden="true"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {story.priority !== "normal" && (
            <Badge
              variant="outline"
              className="text-[10px] capitalize"
              title={t("kanban.card.priorityTooltip", "Priority")}
            >
              {story.priority}
            </Badge>
          )}

          {story.current_agent_slug && (
            <Badge
              variant="secondary"
              className="text-[10px] font-normal"
              title={t("kanban.card.agentTooltip", "Current / latest agent")}
            >
              <Bot className="mr-0.5 size-2.5" aria-hidden="true" />
              {story.current_agent_slug}
              {story.current_run_status === "running" && (
                <span
                  className="ml-1 size-1.5 animate-pulse rounded-full bg-emerald-500"
                  aria-label={t("kanban.card.runningLive", "Running now")}
                />
              )}
            </Badge>
          )}

          {story.default_branch && (
            <Badge
              variant="outline"
              className="text-[10px] font-mono font-normal"
              title={t("kanban.card.branchTooltip", "Default branch")}
            >
              <GitBranch className="mr-0.5 size-2.5" aria-hidden="true" />
              {story.default_branch}
            </Badge>
          )}

          {story.cost_to_date > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] font-normal"
              title={t("kanban.card.costTooltip", "AI cost to date")}
            >
              <DollarSign className="mr-0.5 size-2.5" aria-hidden="true" />
              {formatUsd(story.cost_to_date)}
            </Badge>
          )}

          {liveSession && liveSession.current_phase !== "stopped" && (
            <Badge
              variant="secondary"
              className="text-[10px] font-normal"
              title={t("kanban.card.liveSessionTooltip", {
                defaultValue: "Live {{source}} session — {{phase}}",
                source: liveSession.source,
                phase: liveSession.current_phase,
              })}
            >
              <Activity className="mr-0.5 size-2.5 text-blue-500" aria-hidden="true" />
              {PHASE_LABELS[liveSession.current_phase] ?? liveSession.current_phase}
              {runningSubagentCount(liveSession) > 0 && (
                <span className="ml-1 inline-flex items-center gap-0.5">
                  <Cpu className="size-2.5" aria-hidden="true" />
                  {runningSubagentCount(liveSession)}
                </span>
              )}
            </Badge>
          )}

          <SetBudgetDialog
            storyId={story.story_id}
            storyTitle={story.title}
            budgetState={story.budget_state}
            consumedUsd={story.budget_consumed}
            costLimitUsd={story.budget_cost_limit}
          />
        </div>

        <div
          className="flex items-center gap-1 text-[11px] text-muted-foreground"
          title={new Date(story.last_activity_at).toLocaleString()}
        >
          <Clock className="size-2.5" aria-hidden="true" />
          {formatRelative(story.last_activity_at)}
        </div>
      </div>
    </div>
  );
}

function runningSubagentCount(session: AgentLiveSession): number {
  return session.subagents.filter((s) => s.status === "running").length;
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
