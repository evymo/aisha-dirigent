/**
 * @fileoverview Sync configuration form — profile management, batch/equipment/location
 * selection, entity textareas, toggle switches, and action buttons.
 */

import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { NONE_OPTION_VALUE, NEW_PROFILE_VALUE, SOURCE_OPTIONS } from "./iotUtils";
import type { IotSyncStateReturn } from "./useIotSyncState";
import type { SyncSource } from "./iotUtils";

interface IotSyncConfigFormProps {
  availabilityEntitiesInput: string;
  availableProfiles: IotSyncStateReturn["availableProfiles"];
  batches: IotSyncStateReturn["batches"];
  dryRun: boolean;
  equipment: IotSyncStateReturn["equipment"];
  flowNodeBatchCandidateCount: number;
  handleBatchSelectionChange: (nextBatchId: string) => void;
  handleFlowNodeSelectionChange: (nextFlowNodeId: string) => void;
  handleLoadProfile: () => Promise<void>;
  handleProfileSelectionChange: (nextProfileId: string) => void;
  handleSaveProfile: () => Promise<void>;
  handleSync: () => void;
  isBatchAutoFilled: boolean;
  locations: IotSyncStateReturn["locations"];
  includeAllNumericSensors: boolean;
  profileDescriptionInput: string;
  profileNameInput: string;
  saveSyncProfileStoreMutation: IotSyncStateReturn["saveSyncProfileStoreMutation"];
  selectedBatchId: string;
  selectedEquipmentId: string;
  selectedFlowNodeId: string;
  selectedFlowNodeLabel: string | null;
  selectedLocationId: string;
  selectedProfileId: string;
  sensorEntitiesInput: string;
  setAvailabilityEntitiesInput: (value: string) => void;
  setDryRun: (value: boolean) => void;
  setIncludeAllNumericSensors: (value: boolean) => void;
  setIsDeleteProfileDialogOpen: (open: boolean) => void;
  setProfileDescriptionInput: (value: string) => void;
  setProfileNameInput: (value: string) => void;
  setSelectedEquipmentId: (value: string) => void;
  setSelectedLocationId: (value: string) => void;
  setSensorEntitiesInput: (value: string) => void;
  setSource: (value: SyncSource) => void;
  showBatchAmbiguityWarning: boolean;
  sortedFlowNodes: IotSyncStateReturn["sortedFlowNodes"];
  source: SyncSource;
  syncMutation: IotSyncStateReturn["syncMutation"];
  syncProfileStoreLoading: boolean;
}

/** Configuration card with profile management, context selectors, and sync controls. */
export default function IotSyncConfigForm({
  availabilityEntitiesInput,
  availableProfiles,
  batches,
  dryRun,
  equipment,
  flowNodeBatchCandidateCount,
  handleBatchSelectionChange,
  handleFlowNodeSelectionChange,
  handleLoadProfile,
  handleProfileSelectionChange,
  handleSaveProfile,
  handleSync,
  isBatchAutoFilled,
  locations,
  includeAllNumericSensors,
  profileDescriptionInput,
  profileNameInput,
  saveSyncProfileStoreMutation,
  selectedBatchId,
  selectedEquipmentId,
  selectedFlowNodeId,
  selectedFlowNodeLabel,
  selectedLocationId,
  selectedProfileId,
  sensorEntitiesInput,
  setAvailabilityEntitiesInput,
  setDryRun,
  setIncludeAllNumericSensors,
  setIsDeleteProfileDialogOpen,
  setProfileDescriptionInput,
  setProfileNameInput,
  setSelectedEquipmentId,
  setSelectedLocationId,
  setSensorEntitiesInput,
  setSource,
  showBatchAmbiguityWarning,
  sortedFlowNodes,
  source,
  syncMutation,
  syncProfileStoreLoading,
}: IotSyncConfigFormProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.production.flow.iot.config.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.profiles.selectLabel")}</Label>
            <Select
              value={selectedProfileId}
              onValueChange={handleProfileSelectionChange}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("admin.production.flow.iot.profiles.selectPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_PROFILE_VALUE}>
                  {t("admin.production.flow.iot.profiles.newProfile")}
                </SelectItem>
                {availableProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.profiles.nameLabel")}</Label>
            <Input
              value={profileNameInput}
              onChange={(event) => setProfileNameInput(event.target.value)}
              placeholder={t("admin.production.flow.iot.profiles.namePlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.profiles.flowNodeLabel")}</Label>
            <Select
              value={selectedFlowNodeId}
              onValueChange={handleFlowNodeSelectionChange}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("admin.production.flow.iot.profiles.flowNodePlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_OPTION_VALUE}>
                  {t("admin.production.flow.iot.config.none")}
                </SelectItem>
                {sortedFlowNodes.map((flowNode) => (
                  <SelectItem key={flowNode.id} value={flowNode.id}>
                    {flowNode.node_code} — {flowNode.node_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.profiles.descriptionLabel")}</Label>
            <Input
              value={profileDescriptionInput}
              onChange={(event) => setProfileDescriptionInput(event.target.value)}
              placeholder={t("admin.production.flow.iot.profiles.descriptionPlaceholder")}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Label>{t("admin.production.flow.iot.config.batch")}</Label>
              {isBatchAutoFilled && selectedFlowNodeLabel ? (
                <Badge variant="outline" className="text-xs">
                  {t("admin.production.flow.iot.config.batchAutoFilledFromNode", {
                    node: selectedFlowNodeLabel,
                  })}
                </Badge>
              ) : null}
            </div>
            <Select value={selectedBatchId} onValueChange={handleBatchSelectionChange}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("admin.production.flow.iot.config.selectBatch")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_OPTION_VALUE}>
                  {t("admin.production.flow.iot.config.none")}
                </SelectItem>
                {batches?.map((batch) => (
                  <SelectItem key={batch.id} value={batch.id}>
                    {batch.batch_code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showBatchAmbiguityWarning && selectedFlowNodeLabel ? (
              <Alert className="py-2 px-3">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                  {t("admin.production.flow.iot.config.batchAmbiguousForNode", {
                    count: flowNodeBatchCandidateCount,
                    node: selectedFlowNodeLabel,
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.config.equipment")}</Label>
            <Select
              value={selectedEquipmentId}
              onValueChange={setSelectedEquipmentId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("admin.production.flow.iot.config.selectEquipment")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_OPTION_VALUE}>
                  {t("admin.production.flow.iot.config.none")}
                </SelectItem>
                {equipment?.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.asset_tag} — {item.equipment_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.config.location")}</Label>
            <Select
              value={selectedLocationId}
              onValueChange={setSelectedLocationId}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("admin.production.flow.iot.config.selectLocation")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_OPTION_VALUE}>
                  {t("admin.production.flow.iot.config.none")}
                </SelectItem>
                {locations?.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.location_code} — {location.location_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.config.source")}</Label>
            <Select
              value={source}
              onValueChange={(next) => setSource(next as SyncSource)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((sourceOption) => (
                  <SelectItem key={sourceOption} value={sourceOption}>
                    {t(
                      `admin.production.flow.iot.sourceOptions.${sourceOption}`,
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("admin.production.flow.iot.config.sensorEntities")}</Label>
            <Textarea
              value={sensorEntitiesInput}
              onChange={(event) => setSensorEntitiesInput(event.target.value)}
              placeholder={t(
                "admin.production.flow.iot.config.sensorEntitiesPlaceholder",
              )}
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label>
              {t("admin.production.flow.iot.config.availabilityEntities")}
            </Label>
            <Textarea
              value={availabilityEntitiesInput}
              onChange={(event) =>
                setAvailabilityEntitiesInput(event.target.value)
              }
              placeholder={t(
                "admin.production.flow.iot.config.availabilityEntitiesPlaceholder",
              )}
              rows={4}
            />
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="include-all-numeric"
              checked={includeAllNumericSensors}
              onCheckedChange={setIncludeAllNumericSensors}
            />
            <Label htmlFor="include-all-numeric">
              {t("admin.production.flow.iot.config.includeAllNumericSensors")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="dry-run"
              checked={dryRun}
              onCheckedChange={setDryRun}
            />
            <Label htmlFor="dry-run">
              {t("admin.production.flow.iot.config.dryRun")}
            </Label>
          </div>
          <Button
            variant="outline"
            onClick={() => void handleLoadProfile()}
            disabled={syncProfileStoreLoading}
          >
            {t("admin.production.flow.iot.actions.loadProfile")}
          </Button>
          <Button
            variant="outline"
            onClick={handleSaveProfile}
            disabled={saveSyncProfileStoreMutation.isPending}
          >
            {saveSyncProfileStoreMutation.isPending
              ? t("admin.production.flow.iot.actions.savingProfile")
              : t("admin.production.flow.iot.actions.saveProfile")}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsDeleteProfileDialogOpen(true)}
            disabled={
              saveSyncProfileStoreMutation.isPending ||
              selectedProfileId === NEW_PROFILE_VALUE
            }
          >
            {t("admin.production.flow.iot.actions.deleteProfile")}
          </Button>
          <Button onClick={handleSync} disabled={syncMutation.isPending}>
            {syncMutation.isPending
              ? t("admin.production.flow.iot.actions.syncing")
              : dryRun
                ? t("admin.production.flow.iot.actions.syncDryRun")
                : t("admin.production.flow.iot.actions.syncWrite")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("admin.production.flow.iot.profiles.count", {
            count: availableProfiles.length,
          })}
        </p>
      </CardContent>
    </Card>
  );
}
