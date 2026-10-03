/**
 * @fileoverview Inline IoT sensor data display for protocol step completion.
 *
 * Shows aggregated sensor readings per flow node + reading type for a batch.
 * Highlights excursions and provides a compact summary for verification.
 */
import { useTranslation } from "react-i18next";
import { useProtocolSensorData, type ProtocolSensorData } from "@/hooks";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Activity, ThermometerSun } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ProductionProtocolSensorSectionProps {
  batchId: string;
}

/**
 * Compact sensor data section embedded in protocol step dialogs.
 *
 * Shows all sensor readings for a batch grouped by node, with excursion counts
 * and min/avg/max stats. Designed to be embedded inside DialogContent.
 */
export default function ProductionProtocolSensorSection({
  batchId,
}: ProductionProtocolSensorSectionProps) {
  const { t } = useTranslation();
  const { data: sensorData, isLoading } = useProtocolSensorData(batchId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Activity className="w-4 h-4 animate-pulse" />
        {t("common.loading")}
      </div>
    );
  }

  if (!sensorData || sensorData.length === 0) {
    return null; // Don't show section if no sensor data
  }

  // Group by node
  const byNode = sensorData.reduce<Record<string, ProtocolSensorData[]>>(
    (acc, row) => {
      const key = row.flow_node_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    },
    {},
  );

  const totalExcursions = sensorData.reduce(
    (sum, r) => sum + r.excursion_count,
    0,
  );

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-center gap-2">
        <ThermometerSun className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {t("admin.production.protocol.sensorData.title")}
        </span>
        {totalExcursions > 0 && (
          <Badge variant="destructive" className="text-xs">
            <AlertTriangle className="w-3 h-3 mr-1" />
            {t("admin.production.protocol.sensorData.excursions", {
              count: totalExcursions,
            })}
          </Badge>
        )}
      </div>

      {Object.entries(byNode).map(([nodeId, readings]) => {
        const nodeName = readings[0]?.node_name ?? nodeId;
        const nodeCode = readings[0]?.node_code ?? "";

        return (
          <div
            key={nodeId}
            className="rounded-md border bg-muted/30 p-3 space-y-2"
          >
            <div className="text-xs font-medium text-muted-foreground">
              {nodeCode} — {nodeName}
            </div>
            <div className="grid gap-2">
              {readings.map((r) => (
                <SensorRow key={`${r.flow_node_id}-${r.reading_type}`} row={r} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────── sub-components ──────────────────────

function SensorRow({ row }: { row: ProtocolSensorData }) {
  const { t } = useTranslation();

  const recency = row.latest_recorded_at
    ? formatDistanceToNow(new Date(row.latest_recorded_at), {
        addSuffix: true,
      })
    : "";

  return (
    <div className="flex items-center justify-between text-xs gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium capitalize truncate">
          {t(
            `admin.production.flow.iotConfig.readingTypes.${row.reading_type}`,
          )}
        </span>
        {row.has_excursion && (
          <Badge variant="destructive" className="text-[10px] px-1 py-0">
            {row.excursion_count}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3 text-muted-foreground shrink-0">
        <span>
          {row.min_value.toFixed(1)}–{row.max_value.toFixed(1)}{" "}
          {row.latest_unit}
        </span>
        <span className="font-mono font-medium text-foreground">
          {row.latest_value.toFixed(2)} {row.latest_unit}
        </span>
        <span className="text-[10px]">{recency}</span>
      </div>
    </div>
  );
}
