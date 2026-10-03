/**
 * ClaudeRunApprovalsPending — Mission Control surface for claude_cli_task runs
 * HELD pending approval (fn_admit_clow returned 'ask' on a high-risk autonomous
 * CLI run). Lists each held run with its admission reason + computed risk, and an
 * Approve action (approve_claude_run) that clears the hold so svc-agent-runner
 * drains it. Admin/staff only — the RPCs enforce it + segregation of duties.
 */
import { useTranslation } from "react-i18next";
import { ShieldQuestion, ShieldCheck } from "lucide-react";

import { useClaudeApprovals, useApproveClaudeRun } from "@/hooks/useMissionControl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ClaudeRunApprovalsPending() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useClaudeApprovals();
  const approve = useApproveClaudeRun();
  const pending = data ?? [];

  return (
    <Card data-test="mc-cli-approvals">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {pending.length > 0 ? (
            <ShieldQuestion className="size-4 text-amber-500" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {t("missionControl.claudeApprovals.title", "CLI run approvals")}
          <Badge
            variant={pending.length > 0 ? "destructive" : "outline"}
            className="ml-auto text-[10px]"
            data-test="cli-approvals-count"
          >
            {pending.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.claudeApprovals.subtitle",
            "Agent CLI runs held pending approval (high-risk admission).",
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
        {!isLoading && !error && pending.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("missionControl.claudeApprovals.empty", "No runs awaiting approval.")}
          </p>
        )}
        {pending.map((row) => (
          <div
            key={row.run_id}
            data-test={`cli-approval-${row.run_id}`}
            className="flex items-center gap-2 rounded border bg-muted/30 p-2 text-xs"
          >
            <span className="inline-block size-2 rounded-full bg-amber-500" aria-hidden="true" />
            <div className="flex-1 truncate">
              <span className="font-medium">{row.source ?? "cli"}</span>
              <span className="ml-1 text-muted-foreground">{row.awaiting ?? "approval"}</span>
            </div>
            {row.risk_level && (
              <Badge variant="outline" className="text-[10px] font-normal capitalize">
                {row.risk_level}
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={approve.isPending}
              onClick={() => approve.mutate(row.run_id)}
              data-test={`cli-approve-${row.run_id}`}
            >
              {t("missionControl.claudeApprovals.approve", "Approve")}
            </Button>
          </div>
        ))}
        {approve.isError && (
          <Alert variant="destructive">
            <AlertDescription>{(approve.error as Error).message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
