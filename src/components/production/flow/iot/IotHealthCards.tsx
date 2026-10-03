/**
 * @fileoverview Three health/summary cards for IoT integration panel.
 */

import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { IotSyncStateReturn } from "./useIotSyncState";

interface IotHealthCardsProps {
  health: IotSyncStateReturn["health"];
  healthLoading: boolean;
  refetchHealth: () => void;
  syncMutation: IotSyncStateReturn["syncMutation"];
}

/** HA connectivity + sync summary + availability rate cards. */
export default function IotHealthCards({
  health,
  healthLoading,
  refetchHealth,
  syncMutation,
}: IotHealthCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {t("admin.production.flow.iot.health.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge variant={health?.success ? "default" : "destructive"}>
            {healthLoading
              ? t("common.loading")
              : health?.success
                ? t("admin.production.flow.iot.health.connected")
                : t("admin.production.flow.iot.health.disconnected")}
          </Badge>
          <p className="text-sm text-muted-foreground">
            {t("admin.production.flow.iot.health.transport", {
              transport:
                health?.transport ??
                t("admin.production.flow.iot.health.unavailable"),
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("admin.production.flow.iot.health.version", {
              version:
                health?.ha_version ??
                t("admin.production.flow.iot.health.unavailable"),
            })}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={refetchHealth}
          >
            {t("admin.production.flow.iot.actions.refreshHealth")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {t("admin.production.flow.iot.summary.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            {t("admin.production.flow.iot.summary.sensorsProcessed", {
              count:
                syncMutation.data?.summary.sensors.processed_count ?? 0,
            })}
          </p>
          <p className="text-sm">
            {t("admin.production.flow.iot.summary.availabilityProcessed", {
              count:
                syncMutation.data?.summary.availability.processed_count ?? 0,
            })}
          </p>
          <p className="text-sm">
            {t("admin.production.flow.iot.summary.linksApplied", {
              applied:
                syncMutation.data?.summary.links?.applied_count ?? 0,
              configured:
                syncMutation.data?.summary.links?.configured_count ?? 0,
            })}
          </p>
          <p className="text-sm">
            {t("admin.production.flow.iot.summary.statesFetched", {
              count: syncMutation.data?.summary.states_fetched ?? 0,
            })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {t("admin.production.flow.iot.summary.availabilityRateTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">
            {syncMutation.data?.summary.availability.online_rate_pct ?? 0}%
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {t("admin.production.flow.iot.summary.availabilityRateHint")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
