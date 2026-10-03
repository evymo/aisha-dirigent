/**
 * SpendPolicyCard — the user-driven threshold matrix behind the spend
 * authorizer. One row per (scope × task kind): allow under / ask over /
 * deny over (USD). Rows missing here fall back to the cost-class catalog
 * bands (allow under p90, ask above, deny above 3×p90) — so an empty matrix
 * is a working zero-config state, not an error.
 *
 * MVP editor scope: global rules (per kind or wildcard). Story/partner rows
 * created via RPC show up read-only here.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, Plus, Power } from "lucide-react";
import { toast } from "sonner";

import {
  useSpendPolicies,
  useSetSpendPolicy,
  type SpendPolicy,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SpendPolicyCard() {
  const { t } = useTranslation();
  const { data: policies = [], isLoading, error } = useSpendPolicies();

  return (
    <Card data-test="mc-spend-policy-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {t("missionControl.spendPolicies.title", "Spend policies")}
          <span className="ml-auto">
            <PolicyEditDialog />
          </span>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.spendPolicies.subtitle",
            "Allow / ask / deny thresholds per task kind. No rule = cost-class defaults.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading && <Skeleton className="h-12" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {!isLoading && !error && policies.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t(
              "missionControl.spendPolicies.empty",
              "No custom rules — catalog defaults apply.",
            )}
          </p>
        )}
        {policies.map((policy) => (
          <PolicyRow key={policy.policy_id} policy={policy} />
        ))}
      </CardContent>
    </Card>
  );
}

function PolicyRow({ policy }: { policy: SpendPolicy }) {
  const { t } = useTranslation();
  const setPolicy = useSetSpendPolicy();

  const scopeLabel =
    policy.scope_type === "global"
      ? t("missionControl.spendPolicies.scopeGlobal", "global")
      : (policy.story_title ?? policy.scope_type);

  const toggleActive = () => {
    setPolicy.mutate(
      {
        scopeType: policy.scope_type as "global" | "story" | "partner",
        scopeId: policy.scope_id,
        taskKind: policy.task_kind,
        autoAllowUnderUsd: policy.auto_allow_under,
        askOverUsd: policy.ask_over,
        denyOverUsd: policy.deny_over,
        deactivate: policy.is_active,
      },
      {
        onSuccess: () =>
          toast.success(
            policy.is_active
              ? t("missionControl.spendPolicies.deactivated", "Rule deactivated.")
              : t("missionControl.spendPolicies.activated", "Rule activated."),
          ),
        onError: () => toast.error(t("common.error", "Something went wrong.")),
      },
    );
  };

  return (
    <div
      data-test={`spend-policy-${policy.policy_id}`}
      className={`flex items-center gap-2 rounded border bg-muted/30 p-2 text-xs ${policy.is_active ? "" : "opacity-50"}`}
    >
      <Badge variant="outline" className="text-[10px] shrink-0">
        {scopeLabel}
      </Badge>
      <span className="font-medium truncate">
        {policy.task_kind ?? t("missionControl.spendPolicies.allKinds", "all kinds")}
      </span>
      <span className="ml-auto tabular-nums text-muted-foreground shrink-0">
        {formatThreshold(policy.auto_allow_under)} / {formatThreshold(policy.ask_over)} /{" "}
        {formatThreshold(policy.deny_over)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground"
        onClick={toggleActive}
        disabled={setPolicy.isPending}
        title={
          policy.is_active
            ? t("missionControl.spendPolicies.deactivate", "Deactivate rule")
            : t("missionControl.spendPolicies.activate", "Activate rule")
        }
      >
        <Power className="size-3" aria-hidden="true" />
      </Button>
    </div>
  );
}

function PolicyEditDialog() {
  const { t } = useTranslation();
  const setPolicy = useSetSpendPolicy();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("");
  const [allowUnder, setAllowUnder] = useState("");
  const [askOver, setAskOver] = useState("");
  const [denyOver, setDenyOver] = useState("");

  const parseNum = (v: string): number | null => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const handleSave = () => {
    setPolicy.mutate(
      {
        scopeType: "global",
        scopeId: null,
        taskKind: kind.trim() || null,
        autoAllowUnderUsd: parseNum(allowUnder),
        askOverUsd: parseNum(askOver),
        denyOverUsd: parseNum(denyOver),
      },
      {
        onSuccess: () => {
          toast.success(t("missionControl.spendPolicies.saved", "Rule saved."));
          setOpen(false);
          setKind("");
          setAllowUnder("");
          setAskOver("");
          setDenyOver("");
        },
        onError: () => toast.error(t("common.error", "Something went wrong.")),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
          <Plus className="size-3 mr-1" aria-hidden="true" />
          {t("missionControl.spendPolicies.addRule", "Rule")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("missionControl.spendPolicies.dialogTitle", "Global spend rule")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "missionControl.spendPolicies.dialogSubtitle",
              "Thresholds in USD against the pre-flight estimate. Empty field = catalog default.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="spend-policy-kind">
              {t("missionControl.spendPolicies.kind", "Task kind (empty = all kinds)")}
            </Label>
            <Input
              id="spend-policy-kind"
              placeholder="project_delivery"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="spend-policy-allow" className="text-xs">
                {t("missionControl.spendPolicies.allowUnder", "Allow under")}
              </Label>
              <Input
                id="spend-policy-allow"
                inputMode="decimal"
                placeholder="1.00"
                value={allowUnder}
                onChange={(e) => setAllowUnder(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="spend-policy-ask" className="text-xs">
                {t("missionControl.spendPolicies.askOver", "Ask over")}
              </Label>
              <Input
                id="spend-policy-ask"
                inputMode="decimal"
                placeholder="1.00"
                value={askOver}
                onChange={(e) => setAskOver(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="spend-policy-deny" className="text-xs">
                {t("missionControl.spendPolicies.denyOver", "Deny over")}
              </Label>
              <Input
                id="spend-policy-deny"
                inputMode="decimal"
                placeholder="10.00"
                value={denyOver}
                onChange={(e) => setDenyOver(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button onClick={handleSave} disabled={setPolicy.isPending}>
            {t("common.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatThreshold(v: number | null): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}
