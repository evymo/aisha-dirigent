/**
 * ResolverPolicyCard — the operator's editor for AISHA's orchestration-DECISION weights.
 * The resolver picks model+executor by scoring every candidate:
 *   score = bench×bench_weight + local_bonus + cost_match_weight + tool/vision weights
 * plus cost-class cutoffs + batch thresholds. Those were hardcoded; now they live in
 * ai_resolver_policy and an admin tunes them here (audited server-side; NULL fields inherit).
 * The GLOBAL row is always present (the resolver fails loud without it), so this shows + edits it.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";

import {
  useResolverPolicies,
  useSetResolverPolicy,
  type ResolverPolicy,
} from "@/hooks/useResolverGovernance";
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

export function ResolverPolicyCard() {
  const { t } = useTranslation();
  const { data: policies = [], isLoading, error } = useResolverPolicies();
  const globalPolicy = policies.find((p) => p.scope_type === "global" && p.task_kind === null) ?? null;

  return (
    <Card data-test="mc-resolver-policy-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          {t("missionControl.resolverPolicy.title", "Decision weights")}
          {globalPolicy && (
            <span className="ml-auto">
              <PolicyEditDialog policy={globalPolicy} />
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.resolverPolicy.subtitle",
            "How AISHA weighs candidates when choosing a model + executor. Tuned live; no code change.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <Skeleton className="h-20" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {!isLoading && !error && !globalPolicy && (
          <Alert variant="destructive">
            <AlertDescription>
              {t(
                "missionControl.resolverPolicy.missing",
                "No global decision policy — the resolver will fail loud. Re-run cold-start / heals.",
              )}
            </AlertDescription>
          </Alert>
        )}
        {globalPolicy && <PolicySummary policy={globalPolicy} />}
      </CardContent>
    </Card>
  );
}

function PolicySummary({ policy }: { policy: ResolverPolicy }) {
  const { t } = useTranslation();
  const weights: Array<[string, number]> = [
    [t("missionControl.resolverPolicy.bench", "bench"), policy.bench_weight],
    [t("missionControl.resolverPolicy.local", "local"), policy.local_bonus],
    [t("missionControl.resolverPolicy.cost", "cost-match"), policy.cost_match_weight],
    [t("missionControl.resolverPolicy.tools", "tools"), policy.tool_match_weight],
    [t("missionControl.resolverPolicy.vision", "vision"), policy.vision_match_weight],
  ];
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-1.5">
        {weights.map(([label, value]) => (
          <Badge key={label} variant="outline" className="tabular-nums">
            {label} {value.toFixed(2)}
          </Badge>
        ))}
      </div>
      <div className="text-muted-foreground tabular-nums">
        {t("missionControl.resolverPolicy.costClass", "cost class")}: &lt;$
        {policy.budget_max_cost.toFixed(2)} {t("missionControl.resolverPolicy.budget", "budget")} · &gt;$
        {policy.premium_max_cost.toFixed(2)} {t("missionControl.resolverPolicy.premium", "premium")}
        {" · "}
        {t("missionControl.resolverPolicy.batch", "batch")} ≥{policy.batch_min_deadline_hours}h/
        {(policy.batch_min_tokens / 1000).toFixed(0)}k
      </div>
    </div>
  );
}

const NUM = (v: number): string => String(v);
const parseNum = (v: string): number | null => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function PolicyEditDialog({ policy }: { policy: ResolverPolicy }) {
  const { t } = useTranslation();
  const setPolicy = useSetResolverPolicy();
  const [open, setOpen] = useState(false);

  // pre-fill from the live policy each time the dialog opens.
  const [bench, setBench] = useState(NUM(policy.bench_weight));
  const [local, setLocal] = useState(NUM(policy.local_bonus));
  const [cost, setCost] = useState(NUM(policy.cost_match_weight));
  const [tool, setTool] = useState(NUM(policy.tool_match_weight));
  const [vision, setVision] = useState(NUM(policy.vision_match_weight));
  const [budgetMax, setBudgetMax] = useState(NUM(policy.budget_max_cost));
  const [premiumMax, setPremiumMax] = useState(NUM(policy.premium_max_cost));

  useEffect(() => {
    if (open) {
      setBench(NUM(policy.bench_weight));
      setLocal(NUM(policy.local_bonus));
      setCost(NUM(policy.cost_match_weight));
      setTool(NUM(policy.tool_match_weight));
      setVision(NUM(policy.vision_match_weight));
      setBudgetMax(NUM(policy.budget_max_cost));
      setPremiumMax(NUM(policy.premium_max_cost));
    }
  }, [open, policy]);

  const handleSave = () => {
    setPolicy.mutate(
      {
        scopeType: "global",
        scopeId: null,
        taskKind: null,
        benchWeight: parseNum(bench),
        localBonus: parseNum(local),
        costMatchWeight: parseNum(cost),
        toolMatchWeight: parseNum(tool),
        visionMatchWeight: parseNum(vision),
        budgetMaxCostUsd: parseNum(budgetMax),
        premiumMaxCostUsd: parseNum(premiumMax),
      },
      {
        onSuccess: () => {
          toast.success(t("missionControl.resolverPolicy.saved", "Decision weights saved."));
          setOpen(false);
        },
        onError: () => toast.error(t("common.error", "Something went wrong.")),
      },
    );
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, ph: string) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} inputMode="decimal" placeholder={ph} value={value} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
          <Pencil className="size-3 mr-1" aria-hidden="true" />
          {t("missionControl.resolverPolicy.edit", "Tune")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("missionControl.resolverPolicy.dialogTitle", "Tune decision weights")}</DialogTitle>
          <DialogDescription>
            {t(
              "missionControl.resolverPolicy.dialogSubtitle",
              "Global scoring weights + cost-class cutoffs. Empty field keeps the current value.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t("missionControl.resolverPolicy.weightsGroup", "Scoring weights")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {field("rp-bench", t("missionControl.resolverPolicy.bench", "bench"), bench, setBench, "0.55")}
            {field("rp-local", t("missionControl.resolverPolicy.local", "local"), local, setLocal, "0.20")}
            {field("rp-cost", t("missionControl.resolverPolicy.cost", "cost-match"), cost, setCost, "0.15")}
            {field("rp-tool", t("missionControl.resolverPolicy.tools", "tools"), tool, setTool, "0.05")}
            {field("rp-vision", t("missionControl.resolverPolicy.vision", "vision"), vision, setVision, "0.05")}
          </div>
          <p className="text-xs font-medium text-muted-foreground">
            {t("missionControl.resolverPolicy.costGroup", "Cost-class cutoffs (USD)")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {field("rp-budgetmax", t("missionControl.resolverPolicy.budgetMax", "budget under"), budgetMax, setBudgetMax, "0.50")}
            {field("rp-premiummax", t("missionControl.resolverPolicy.premiumMax", "premium over"), premiumMax, setPremiumMax, "5.00")}
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
