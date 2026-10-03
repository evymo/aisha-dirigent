/**
 * KanbanMini — mission-control summary of partner_stories status counts.
 *
 * Reuses useKanbanBoard (live via partner_stories UPDATE) and presents
 * a horizontal bar of (status label, count) chips. Clicking the title
 * routes to the full kanban page.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { KanbanSquare, ChevronRight } from "lucide-react";

import { useKanbanBoard } from "@/hooks/useKanbanBoard";
import { useWorkflowStatuses } from "@/hooks/useWorkflowStatuses";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function KanbanMini() {
  const { t } = useTranslation();
  const board = useKanbanBoard();
  const statuses = useWorkflowStatuses();

  const counts = useMemo(() => {
    const m = new Map<string, { stack: number; user: number }>();
    for (const story of board.data ?? []) {
      const entry = m.get(story.status) ?? { stack: 0, user: 0 };
      if (story.is_stack_default) entry.stack += 1;
      else entry.user += 1;
      m.set(story.status, entry);
    }
    return m;
  }, [board.data]);

  const orderedStatuses = (statuses.data ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const total = (board.data ?? []).length;

  return (
    <Card data-test="mc-kanban-mini">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <KanbanSquare className="size-4" aria-hidden="true" />
          {t("missionControl.kanbanMini.title", "Stories kanban")}
          <Link
            to="/admin/mission-control/kanban"
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            {t("missionControl.kanbanMini.open", "Open board")}
            <ChevronRight
              className="ml-0.5 inline size-3"
              aria-hidden="true"
            />
          </Link>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.kanbanMini.subtitle",
            "{{total}} stories across the lifecycle.",
            { total },
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(board.isLoading || statuses.isLoading) && (
          <Skeleton className="h-12" />
        )}
        {(board.error || statuses.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {(board.error as Error | null)?.message ??
                (statuses.error as Error | null)?.message}
            </AlertDescription>
          </Alert>
        )}
        {!board.isLoading && !statuses.isLoading && (
          <div className="flex flex-wrap gap-1.5">
            {orderedStatuses.map((status) => {
              const c = counts.get(status.status) ?? { stack: 0, user: 0 };
              const total = c.stack + c.user;
              return (
                <div
                  key={status.status}
                  className="flex items-center gap-1 rounded border bg-muted/30 px-2 py-1 text-xs"
                  data-test={`kanban-mini-${status.status}`}
                >
                  <span className="font-medium">
                    {t(status.label_i18n_key)}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {total}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
