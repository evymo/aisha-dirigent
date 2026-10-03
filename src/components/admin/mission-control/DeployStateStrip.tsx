/**
 * DeployStateStrip — mission-control pane summarizing blue/green slot state.
 *
 * Each app gets a compact row: active slot color + image tag + health, plus
 * "lock" hint if a switch is in progress. Subscribes to coolify_app_slots
 * for instant updates after blue-green switches.
 */
import { useTranslation } from "react-i18next";
import { Server, Lock, Activity } from "lucide-react";

import { useDeployState } from "@/hooks/useMissionControl";
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

export function DeployStateStrip() {
  const { t } = useTranslation();
  const { data: slots = [], isLoading, error } = useDeployState();

  return (
    <Card data-test="mc-deploy-state-strip">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="size-4" aria-hidden="true" />
          {t("missionControl.deploy.title", "Deploy state")}
          <Badge variant="outline" className="ml-auto text-[10px]">
            {slots.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t(
            "missionControl.deploy.subtitle",
            "Active blue/green slots per app.",
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
        {!isLoading && slots.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("missionControl.deploy.empty", "No tracked apps.")}
          </p>
        )}
        {slots.map((slot) => (
          <div
            key={slot.app_name}
            data-test={`deploy-slot-${slot.app_name}`}
            className="flex items-center gap-2 rounded border bg-muted/30 p-2 text-sm"
          >
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                slot.active_slot === "blue" ? "bg-blue-500" : "bg-emerald-500",
              )}
              aria-label={slot.active_slot}
            />
            <div className="flex-1 truncate">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{slot.app_name}</span>
                <Badge
                  variant="outline"
                  className="text-[10px] font-normal capitalize"
                >
                  {slot.active_slot}
                </Badge>
                {slot.switch_lock && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-normal"
                    title={t(
                      "missionControl.deploy.lockTooltip",
                      "Switch in progress",
                    )}
                  >
                    <Lock className="mr-0.5 size-2.5" aria-hidden="true" />
                    {slot.switch_lock_age_min ?? "—"}m
                  </Badge>
                )}
              </div>
              {slot.active_image_tag && (
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {slot.active_image_tag}
                </div>
              )}
            </div>
            {slot.active_health && (
              <Badge
                variant={
                  slot.active_health === "healthy"
                    ? "default"
                    : "destructive"
                }
                className="text-[10px] font-normal"
              >
                <Activity className="mr-0.5 size-2.5" aria-hidden="true" />
                {slot.active_health}
              </Badge>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
