/**
 * DriftMeter — compact gauge of unresolved drift_state rows by risk threshold.
 *
 * Surfaces a single number with a risk-colored badge. Subscribes to
 * drift_state INSERTs so the gauge ticks up the moment WF_DRIFT_OBSERVER
 * records a new finding.
 */
import { useTranslation } from "react-i18next";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { useDriftCount } from "@/hooks/useMissionControl";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface DriftMeterProps {
  /** Lowest risk level to count (default "medium" — ignores noise). */
  minRisk?: "low" | "medium" | "high" | "critical";
}

export function DriftMeter({ minRisk = "medium" }: DriftMeterProps) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useDriftCount({ minRisk });
  const count = data?.[0]?.count ?? 0;

  return (
    <Card data-test="mc-drift-meter" data-min-risk={minRisk}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {count > 0 ? (
            <AlertTriangle className="size-4 text-amber-500" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4 text-emerald-500" aria-hidden="true" />
          )}
          {t("missionControl.drift.title", "Drift")}
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.drift.subtitle",
            "Unresolved findings at risk ≥ {{minRisk}}.",
            { minRisk },
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-12 w-20" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {!isLoading && !error && (
          <div
            className={cn(
              "text-3xl font-semibold tabular-nums",
              count === 0
                ? "text-emerald-600"
                : count < 5
                  ? "text-amber-600"
                  : "text-destructive",
            )}
            data-test="drift-count"
          >
            {count}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
