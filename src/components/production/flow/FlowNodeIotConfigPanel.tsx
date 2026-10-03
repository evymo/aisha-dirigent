/**
 * @fileoverview IoT entity mapping panel for a production flow node.
 *
 * Lets admins configure which Home Assistant entities are linked to
 * a flow node and define thresholds / reading types for each.
 * Config is stored in the node's `metadata.iot_config` via
 * `useFlowNodeIotConfig` hook.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Radio, Settings, Save } from "lucide-react";
import {
  useFlowNodeIotConfig,
  type FlowNode,
  type IotConfig,
  type IotEntityMapping,
} from "@/hooks";

const READING_TYPES = [
  "temperature",
  "humidity",
  "pressure",
  "ph",
  "weight",
  "flow_rate",
  "power",
  "duration",
  "conductivity",
  "dissolved_oxygen",
  "custom",
] as const;

const DEFAULT_UNITS: Record<string, string> = {
  conductivity: "mS/cm",
  custom: "",
  dissolved_oxygen: "mg/L",
  duration: "min",
  flow_rate: "L/min",
  humidity: "%",
  ph: "pH",
  power: "kW",
  pressure: "kPa",
  temperature: "°C",
  weight: "kg",
};

interface FlowNodeIotConfigPanelProps {
  nodeId: string | undefined;
  nodes: FlowNode[] | undefined;
}

const EMPTY_ENTITY: IotEntityMapping = {
  entity_id: "",
  label: "",
  max_threshold: null,
  min_threshold: null,
  reading_type: "temperature",
  unit: "°C",
};

/**
 * Panel for configuring IoT entity mappings on a flow node.
 */
export default function FlowNodeIotConfigPanel({
  nodeId,
  nodes,
}: FlowNodeIotConfigPanelProps) {
  const { t } = useTranslation();
  const { iotConfig, isUpdating, updateIotConfig } = useFlowNodeIotConfig(
    nodeId,
    nodes,
  );

  const [localConfig, setLocalConfig] = useState<IotConfig>(iotConfig);
  const [isDirty, setIsDirty] = useState(false);

  // sync from server when config changes
  useEffect(() => {
    setLocalConfig(iotConfig);
    setIsDirty(false);
  }, [iotConfig]);

  const updateLocal = useCallback((patch: Partial<IotConfig>) => {
    setLocalConfig((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
  }, []);

  const updateEntity = useCallback(
    (index: number, patch: Partial<IotEntityMapping>) => {
      setLocalConfig((prev) => {
        const entities = [...prev.entities];
        entities[index] = { ...entities[index], ...patch };
        return { ...prev, entities };
      });
      setIsDirty(true);
    },
    [],
  );

  const addEntity = useCallback(() => {
    setLocalConfig((prev) => ({
      ...prev,
      entities: [...prev.entities, { ...EMPTY_ENTITY }],
    }));
    setIsDirty(true);
  }, []);

  const removeEntity = useCallback((index: number) => {
    setLocalConfig((prev) => ({
      ...prev,
      entities: prev.entities.filter((_, i) => i !== index),
    }));
    setIsDirty(true);
  }, []);

  const handleSave = async () => {
    // Validate all entities have required fields
    const invalid = localConfig.entities.some(
      (e) => !e.entity_id.trim() || !e.label.trim(),
    );
    if (invalid) {
      toast.error(t("admin.production.flow.iotConfig.validation.requiredFields"));
      return;
    }
    try {
      await updateIotConfig(localConfig);
      toast.success(t("admin.production.flow.iotConfig.saved"));
      setIsDirty(false);
    } catch {
      toast.error(t("admin.production.flow.errors.saveFailed"));
    }
  };

  if (!nodeId) {
    return (
      <div className="text-sm text-muted-foreground p-4 text-center">
        {t("admin.production.flow.iotConfig.selectNode")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Global settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings className="w-4 h-4" />
            {t("admin.production.flow.iotConfig.globalSettings")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>{t("admin.production.flow.iotConfig.syncEnabled")}</Label>
            <Switch
              checked={localConfig.sync_enabled}
              onCheckedChange={(checked) =>
                updateLocal({ sync_enabled: checked })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>
              {t("admin.production.flow.iotConfig.pollingInterval")}
            </Label>
            <Input
              type="number"
              min={10}
              step={10}
              value={localConfig.polling_interval_seconds}
              onChange={(e) =>
                updateLocal({
                  polling_interval_seconds: Math.max(
                    10,
                    parseInt(e.target.value) || 300,
                  ),
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Entity mappings */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Radio className="w-4 h-4" />
            {t("admin.production.flow.iotConfig.entityMappings")}
          </h4>
          <Button variant="outline" size="sm" onClick={addEntity}>
            <Plus className="w-3 h-3 mr-1" />
            {t("admin.production.flow.iotConfig.addEntity")}
          </Button>
        </div>

        {localConfig.entities.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
            {t("admin.production.flow.iotConfig.noEntities")}
          </p>
        )}

        {localConfig.entities.map((entity, idx) => (
          <Card key={idx} className="relative">
            <CardContent className="pt-4 space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-xs text-muted-foreground">
                  #{idx + 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeEntity(idx)}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="w-3 h-3 text-destructive" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {t("admin.production.flow.iotConfig.entityId")}
                  </Label>
                  <Input
                    value={entity.entity_id}
                    onChange={(e) =>
                      updateEntity(idx, { entity_id: e.target.value })
                    }
                    placeholder={t("admin.production.flow.iotConfig.entityIdPlaceholder")}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {t("admin.production.flow.iotConfig.entityLabel")}
                  </Label>
                  <Input
                    value={entity.label}
                    onChange={(e) =>
                      updateEntity(idx, { label: e.target.value })
                    }
                    className="text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {t("admin.production.flow.iotConfig.readingType")}
                  </Label>
                  <Select
                    value={entity.reading_type}
                    onValueChange={(v) => {
                      updateEntity(idx, {
                        reading_type: v,
                        unit: DEFAULT_UNITS[v] ?? entity.unit,
                      });
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {READING_TYPES.map((rt) => (
                        <SelectItem key={rt} value={rt}>
                          {t(
                            `admin.production.flow.iotConfig.readingTypes.${rt}`,
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {t("admin.production.flow.iotConfig.unit")}
                  </Label>
                  <Input
                    value={entity.unit}
                    onChange={(e) =>
                      updateEntity(idx, { unit: e.target.value })
                    }
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1 col-span-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {t("admin.production.flow.iotConfig.minThreshold")}
                  </Label>
                  <Input
                    type="number"
                    step="any"
                    value={entity.min_threshold ?? ""}
                    onChange={(e) =>
                      updateEntity(idx, {
                        min_threshold: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    {t("admin.production.flow.iotConfig.maxThreshold")}
                  </Label>
                  <Input
                    type="number"
                    step="any"
                    value={entity.max_threshold ?? ""}
                    onChange={(e) =>
                      updateEntity(idx, {
                        max_threshold: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                    className="text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={isUpdating || !isDirty}>
          <Save className="w-4 h-4 mr-2" />
          {isUpdating ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
