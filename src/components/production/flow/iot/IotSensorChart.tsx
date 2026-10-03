/**
 * @fileoverview Time-series sensor chart and recent readings table for IoT integration.
 */

import { useTranslation } from "react-i18next";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

import { ALL_READING_TYPES_VALUE, NONE_OPTION_VALUE, READING_TYPE_OPTIONS } from "./iotUtils";
import type { IotSyncStateReturn } from "./useIotSyncState";

interface IotSensorChartProps {
  chartReadings: IotSyncStateReturn["chartReadings"];
  chartSensorCodes: string[];
  latestReadings: IotSyncStateReturn["latestReadings"];
  readingsLoading: boolean;
  selectedReadingType: string;
  selectedSensorCode: string;
  setSelectedReadingType: (value: string) => void;
  setSelectedSensorCode: (value: string) => void;
}

/** Sensor time-series line chart with reading type / sensor code filters. */
export default function IotSensorChart({
  chartReadings,
  chartSensorCodes,
  latestReadings,
  readingsLoading,
  selectedReadingType,
  selectedSensorCode,
  setSelectedReadingType,
  setSelectedSensorCode,
}: IotSensorChartProps) {
  const { t } = useTranslation();

  const chartConfig = {
    value: {
      color: "hsl(var(--primary))",
      label: t("admin.production.flow.iot.chart.valueLabel"),
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.production.flow.iot.chart.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.chart.readingType")}</Label>
            <Select
              value={selectedReadingType}
              onValueChange={setSelectedReadingType}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_READING_TYPES_VALUE}>
                  {t("admin.production.flow.iot.chart.allReadingTypes")}
                </SelectItem>
                {READING_TYPE_OPTIONS.map((readingType) => (
                  <SelectItem key={readingType} value={readingType}>
                    {t(`admin.production.flow.iot.readingTypes.${readingType}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.chart.sensorCode")}</Label>
            <Select
              value={selectedSensorCode}
              onValueChange={setSelectedSensorCode}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_OPTION_VALUE}>
                  {t("admin.production.flow.iot.chart.autoSensor")}
                </SelectItem>
                {chartSensorCodes.map((sensorCode) => (
                  <SelectItem key={sensorCode} value={sensorCode}>
                    {sensorCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {readingsLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : chartReadings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("admin.production.flow.iot.chart.empty")}
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <LineChart
              data={chartReadings}
              margin={{ left: 12, right: 12, top: 8, bottom: 8 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="recordedAt"
                minTickGap={28}
                tickLine={false}
                axisLine={false}
              />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent />}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-value)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        )}

        {latestReadings.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.production.flow.iot.chart.recordedAt")}</TableHead>
                <TableHead>{t("admin.production.flow.iot.chart.value")}</TableHead>
                <TableHead>{t("admin.production.flow.iot.chart.excursion")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latestReadings.map((reading) => (
                <TableRow key={reading.id}>
                  <TableCell>
                    {new Date(reading.recorded_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {reading.value} {reading.unit}
                  </TableCell>
                  <TableCell>
                    {reading.is_excursion ? (
                      <Badge variant="destructive">
                        {reading.excursion_severity ??
                          t("admin.production.flow.iot.chart.excursionDetected")}
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        {t("admin.production.flow.iot.chart.noExcursion")}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
