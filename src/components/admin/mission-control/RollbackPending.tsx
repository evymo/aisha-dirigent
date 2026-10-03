/**
 * RollbackPending — surfaces pending rollback approval requests + recent
 * history. Subscribes to rollback_history UPDATEs so approvals show up
 * within ~2s of the workflow firing them.
 */
import { useTranslation } from "react-i18next";
import { Undo2, AlertOctagon } from "lucide-react";

import { useRollbackBoard } from "@/hooks/useMissionControl";
import { cn } from "@/lib/utils";
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

export function RollbackPending() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useRollbackBoard({ historyLimit: 5 });
  const board = data?.[0];
  const pending = board?.pending_count ?? 0;
  const history = board?.history ?? [];

  return (
    <Card data-test="mc-rollback-pending">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {pending > 0 ? (
            <AlertOctagon className="size-4 text-destructive" aria-hidden="true" />
          ) : (
            <Undo2 className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {t("missionControl.rollback.title", "Rollback")}
          <Badge
            variant={pending > 0 ? "destructive" : "outline"}
            className="ml-auto text-[10px]"
            data-test="rollback-pending-count"
          >
            {pending}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.rollback.subtitle",
            "Pending approval + recent rollback history.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading && <Skeleton className="h-16" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {!isLoading && !error && history.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("missionControl.rollback.empty", "No recent rollbacks.")}
          </p>
        )}
        {history.map((row) => (
          <div
            key={row.id}
            data-test={`rollback-${row.id}`}
            className="flex items-center gap-2 rounded border bg-muted/30 p-2 text-xs"
          >
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                row.approval_status === "pending"
                  ? "bg-amber-500"
                  : row.execution_status === "succeeded"
                    ? "bg-emerald-500"
                    : "bg-muted",
              )}
            />
            <div className="flex-1 truncate">
              <span className="font-medium">{row.app_name}</span>
              <span className="ml-1 text-muted-foreground">
                {row.from_slot} → {row.to_slot}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px] font-normal capitalize">
              {row.approval_status}
            </Badge>
            <span className="text-muted-foreground">
              {row.age_minutes != null ? `${row.age_minutes}m` : "—"}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
