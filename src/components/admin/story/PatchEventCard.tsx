/**
 * PatchEventCard — one row of the StoryTimeline.
 *
 * Visual taxonomy by event_kind:
 *   trace      — agent / LLM call / tool call / patch
 *   rollback   — B/G rollback (with from→to slot info)
 *   bg_switch  — successful blue/green slot promotion
 *
 * For `patch_applied` trace events we expose files_changed[] (the most
 * git-like view the user explicitly asked for — "kde co AISHA mění" rather
 * than full inline diff).
 */
import { useTranslation } from "react-i18next";
import {
  FileText,
  GitBranch,
  Bot,
  Undo2,
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Wrench,
} from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import type { StoryTimelineEvent } from "@/hooks/useStoryTimeline";

export interface PatchEventCardProps {
  event: StoryTimelineEvent;
}

const KIND_ICON: Record<string, typeof Bot> = {
  trace: Wrench,
  rollback: Undo2,
  bg_switch: ArrowLeftRight,
};

const PATCH_ICON_FOR_TRACE: Record<string, typeof Bot> = {
  patch_applied: FileText,
  llm_call: Bot,
  tool_call: Wrench,
  human_approval: AlertTriangle,
  workflow_node: GitBranch,
  workflow_transition: GitBranch,
  evaluation: CheckCircle2,
};

export function PatchEventCard({ event }: PatchEventCardProps) {
  const { t } = useTranslation();

  const Icon =
    event.event_kind === "trace" && event.trace_event_type
      ? (PATCH_ICON_FOR_TRACE[event.trace_event_type] ?? KIND_ICON[event.event_kind])
      : KIND_ICON[event.event_kind] ?? Wrench;

  const accent = statusAccent(event.status);
  const isPatch =
    event.event_kind === "trace" && event.trace_event_type === "patch_applied";

  return (
    <Card
      data-test={`timeline-event-${event.event_id}`}
      data-event-kind={event.event_kind}
      className={cn("border-l-4", accent)}
    >
      <CardHeader className="flex flex-row items-start gap-2 space-y-0 pb-1">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium">
              {labelForEvent(event)}
            </span>
            {event.trace_event_type && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {event.trace_event_type}
              </Badge>
            )}
            {event.agent_slug && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                <Bot className="mr-0.5 size-2.5" aria-hidden="true" />
                {event.agent_slug}
              </Badge>
            )}
            {event.app_name && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {event.app_name}
              </Badge>
            )}
            {event.status && (
              <Badge
                variant={
                  ["failed", "error"].includes(event.status.toLowerCase())
                    ? "destructive"
                    : "outline"
                }
                className="text-[10px] font-normal"
              >
                {event.status}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Clock className="size-2.5" aria-hidden="true" />
            <time dateTime={event.ts} title={new Date(event.ts).toLocaleString()}>
              {new Date(event.ts).toLocaleString()}
            </time>
            {event.duration_ms != null && (
              <span>· {event.duration_ms}ms</span>
            )}
            {event.cost != null && (
              <span>· ${event.cost.toFixed(4)}</span>
            )}
            {event.run_id && (
              <Link
                to={`/admin/ai-runs/${event.run_id}`}
                className="hover:underline"
              >
                · run
              </Link>
            )}
          </div>
        </div>
      </CardHeader>

      {(isPatch && event.files_changed && event.files_changed.length > 0) && (
        <CardContent className="pb-3 pt-0">
          <ul
            className="space-y-0.5 text-[11px] font-mono text-muted-foreground"
            data-test="patch-files-changed"
          >
            {event.files_changed.map((f) => (
              <li key={f} className="truncate">
                <FileText
                  className="mr-1 inline size-2.5"
                  aria-hidden="true"
                />
                {f}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function statusAccent(status: string | null): string {
  if (!status) return "border-l-muted";
  const s = status.toLowerCase();
  if (s === "failed" || s === "error") return "border-l-destructive";
  if (s === "succeeded" || s === "completed" || s === "approved")
    return "border-l-emerald-500";
  if (s === "pending" || s === "running") return "border-l-amber-500";
  return "border-l-muted";
}

function labelForEvent(event: StoryTimelineEvent): string {
  if (event.event_kind === "trace") {
    return event.operation ?? event.trace_event_type ?? "trace";
  }
  return event.operation ?? event.event_kind;
}
