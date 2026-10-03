/**
 * DecisionLensCard — the operator's window into HOW AISHA decided. Each recent orchestration
 * decision shows the chosen model/executor, estimated-vs-actual cost, the active policy, and (on
 * expand) the full per-candidate ranking with the resolver's score breakdown — so an operator can
 * SEE the process + reasoning + cost, not just the outcome. Read-only (get_ai_decisions_admin).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, ChevronDown, ChevronRight } from "lucide-react";

import { useAiDecisions, type AiDecision } from "@/hooks/useResolverGovernance";
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

function fmtCost(v: number | null): string {
  return v == null ? "—" : `$${v.toFixed(4)}`;
}

export function DecisionLensCard() {
  const { t } = useTranslation();
  const { data: decisions = [], isLoading, error } = useAiDecisions({ limit: 25 });

  return (
    <Card data-test="ai-decision-lens-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="size-4" aria-hidden="true" />
          {t("admin.aiObservability.decisions.title", "Recent decisions")}
        </CardTitle>
        <CardDescription>
          {t(
            "admin.aiObservability.decisions.subtitle",
            "Why AISHA chose each model + executor, with estimated-vs-actual cost. Expand for the candidate ranking.",
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
        {!isLoading && !error && decisions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("admin.aiObservability.decisions.empty", "No decisions journaled yet.")}
          </p>
        )}
        {decisions.map((d) => (
          <DecisionRow key={d.decision_id} decision={d} />
        ))}
      </CardContent>
    </Card>
  );
}

function DecisionRow({ decision: d }: { decision: AiDecision }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hasCandidates = d.candidates.length > 0;

  return (
    <div data-test={`ai-decision-${d.decision_id}`} className="rounded border bg-muted/30 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-2 text-left"
        onClick={() => hasCandidates && setOpen((v) => !v)}
        disabled={!hasCandidates}
      >
        {hasCandidates ? (
          open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <Badge variant="outline" className="text-[10px] shrink-0">
          {d.runtime ?? "—"}
        </Badge>
        <span className="font-medium truncate">
          {d.provider_slug ?? "—"}/{d.model_id ?? "—"}
        </span>
        <span className="ml-auto tabular-nums text-muted-foreground shrink-0">
          {t("admin.aiObservability.decisions.est", "est")} {fmtCost(d.estimated_cost)} ·{" "}
          {t("admin.aiObservability.decisions.actual", "act")} {fmtCost(d.actual_cost)}
        </span>
      </button>
      {open && hasCandidates && (
        <div className="border-t px-2 py-1.5">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">#</th>
                <th className="text-left font-normal">{t("admin.aiObservability.decisions.candidate", "candidate")}</th>
                <th className="text-right font-normal">{t("admin.aiObservability.decisions.score", "score")}</th>
                <th className="text-left font-normal pl-2">{t("admin.aiObservability.decisions.breakdown", "breakdown")}</th>
              </tr>
            </thead>
            <tbody>
              {d.candidates.map((c) => (
                <tr key={c.rank} className={c.is_top ? "font-medium" : "text-muted-foreground"}>
                  <td>{c.rank}</td>
                  <td className="truncate">
                    {c.provider_slug ?? "—"}/{c.model_id ?? "—"}
                  </td>
                  <td className="text-right">{c.score == null ? "—" : c.score.toFixed(4)}</td>
                  <td className="pl-2 truncate text-muted-foreground">{c.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
