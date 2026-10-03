/**
 * SpendApprovalPending — mission-control pane for runs blocked at admission
 * by the spend authorizer ('ask' decisions from fn_authorize_task_spend).
 *
 * Each row: task kind, story, pre-flight estimate, decision reason, age.
 * Approve (optionally raising the story lifetime budget by the estimate) or
 * reject with a note. Both actions are audited SECURITY DEFINER RPCs; the
 * agent learns the outcome via dirigent_nudges on its next Stop event.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Coins, Check, X, Clock } from "lucide-react";
import { toast } from "sonner";

import {
  useSpendApprovals,
  useApproveTaskSpend,
  useRejectTaskSpend,
  type SpendApproval,
} from "@/hooks/useSpendGovernance";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function SpendApprovalPending() {
  const { t } = useTranslation();
  const { data: approvals = [], isLoading, error } = useSpendApprovals({ limit: 10 });

  return (
    <Card data-test="mc-spend-approval-pending">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins
            className={approvals.length > 0 ? "size-4 text-amber-500" : "size-4"}
            aria-hidden="true"
          />
          {t("missionControl.spendApprovals.title", "Spend approvals")}
          <Badge
            variant={approvals.length > 0 ? "destructive" : "outline"}
            className="ml-auto text-[10px]"
            data-test="spend-pending-count"
          >
            {approvals.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.spendApprovals.subtitle",
            "Tasks waiting for a cost decision before they start.",
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
        {!isLoading && !error && approvals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("missionControl.spendApprovals.empty", "Nothing awaiting approval.")}
          </p>
        )}
        {approvals.map((approval) => (
          <ApprovalRow key={approval.run_id} approval={approval} />
        ))}
      </CardContent>
    </Card>
  );
}

function ApprovalRow({ approval }: { approval: SpendApproval }) {
  const { t } = useTranslation();

  return (
    <div
      data-test={`spend-approval-${approval.run_id}`}
      className="rounded border bg-muted/30 p-2 text-xs space-y-1"
    >
      <div className="flex items-center gap-2">
        <span className="inline-block size-2 rounded-full bg-amber-500" />
        <span className="font-medium">{approval.kind}</span>
        {approval.estimate != null && (
          <Badge variant="outline" className="text-[10px] tabular-nums">
            ~${approval.estimate.toFixed(2)}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" aria-hidden="true" />
          {formatAge(approval.age_ms)}
        </span>
      </div>
      <div className="truncate text-muted-foreground">
        {approval.story_title ?? t("missionControl.spendApprovals.noStory", "No story")}
        {approval.decision_reason ? ` · ${approval.decision_reason}` : ""}
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <ApproveButton approval={approval} />
        <RejectButton approval={approval} />
      </div>
    </div>
  );
}

function ApproveButton({ approval }: { approval: SpendApproval }) {
  const { t } = useTranslation();
  const approve = useApproveTaskSpend();
  const [raiseBudget, setRaiseBudget] = useState(true);

  const handleConfirm = () => {
    approve.mutate(
      {
        runId: approval.run_id,
        raiseBudgetUsd:
          raiseBudget && approval.estimate != null && approval.estimate > 0
            ? approval.estimate
            : undefined,
      },
      {
        onSuccess: () =>
          toast.success(t("missionControl.spendApprovals.approved", "Spend approved.")),
        onError: () => toast.error(t("common.error", "Something went wrong.")),
      },
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-emerald-600 hover:text-emerald-700"
          disabled={approve.isPending}
        >
          <Check className="size-3 mr-1" aria-hidden="true" />
          {t("missionControl.spendApprovals.approve", "Approve")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("missionControl.spendApprovals.approveTitle", "Approve this spend?")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("missionControl.spendApprovals.approveConfirm", {
              defaultValue:
                'Allow "{{kind}}" (estimated ~${{estimate}}) to start? The decision is audited.',
              kind: approval.kind,
              estimate: approval.estimate?.toFixed(2) ?? "?",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {approval.estimate != null && approval.story_id != null && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={raiseBudget}
              onCheckedChange={(v) => setRaiseBudget(v === true)}
            />
            {t("missionControl.spendApprovals.raiseBudget", {
              defaultValue: "Also raise the story lifetime budget by ${{estimate}}",
              estimate: approval.estimate.toFixed(2),
            })}
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            {t("missionControl.spendApprovals.approve", "Approve")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RejectButton({ approval }: { approval: SpendApproval }) {
  const { t } = useTranslation();
  const reject = useRejectTaskSpend();

  const handleConfirm = () => {
    reject.mutate(
      { runId: approval.run_id },
      {
        onSuccess: () =>
          toast.success(t("missionControl.spendApprovals.rejected", "Spend rejected.")),
        onError: () => toast.error(t("common.error", "Something went wrong.")),
      },
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-muted-foreground hover:text-destructive"
          disabled={reject.isPending}
        >
          <X className="size-3 mr-1" aria-hidden="true" />
          {t("missionControl.spendApprovals.reject", "Reject")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("missionControl.spendApprovals.rejectTitle", "Reject this spend?")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("missionControl.spendApprovals.rejectConfirm", {
              defaultValue: 'Cancel "{{kind}}"? The run will not start.',
              kind: approval.kind,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("missionControl.spendApprovals.reject", "Reject")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
