/**
 * @fileoverview Orchestrator for IoT integration section.
 * Combines useIotSyncState hook with presentational sub-components.
 */

import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import IotHealthCards from "./IotHealthCards";
import IotSyncConfigForm from "./IotSyncConfigForm";
import IotEntityLinksTable from "./IotEntityLinksTable";
import IotSensorChart from "./IotSensorChart";
import { useIotSyncState } from "./useIotSyncState";

/**
 * Flow tab section for mapping Home Assistant entities and syncing immutable
 * production sensor readings with protocol context.
 */
export default function FlowIotIntegrationSection() {
  const { t } = useTranslation();
  const state = useIotSyncState();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">
          {t("admin.production.flow.iot.title")}
        </h3>
        <p className="text-muted-foreground">
          {t("admin.production.flow.iot.description")}
        </p>
      </div>

      <IotHealthCards
        health={state.health}
        healthLoading={state.healthLoading}
        refetchHealth={state.refetchHealth}
        syncMutation={state.syncMutation}
      />

      <IotSyncConfigForm
        availabilityEntitiesInput={state.availabilityEntitiesInput}
        availableProfiles={state.availableProfiles}
        batches={state.batches}
        dryRun={state.dryRun}
        equipment={state.equipment}
        flowNodeBatchCandidateCount={state.flowNodeBatchCandidateCount}
        handleBatchSelectionChange={state.handleBatchSelectionChange}
        handleFlowNodeSelectionChange={state.handleFlowNodeSelectionChange}
        handleLoadProfile={state.handleLoadProfile}
        handleProfileSelectionChange={state.handleProfileSelectionChange}
        handleSaveProfile={state.handleSaveProfile}
        handleSync={state.handleSync}
        isBatchAutoFilled={state.isBatchAutoFilled}
        includeAllNumericSensors={state.includeAllNumericSensors}
        locations={state.locations}
        profileDescriptionInput={state.profileDescriptionInput}
        profileNameInput={state.profileNameInput}
        saveSyncProfileStoreMutation={state.saveSyncProfileStoreMutation}
        selectedBatchId={state.selectedBatchId}
        selectedEquipmentId={state.selectedEquipmentId}
        selectedFlowNodeId={state.selectedFlowNodeId}
        selectedFlowNodeLabel={state.selectedFlowNodeLabel}
        selectedLocationId={state.selectedLocationId}
        selectedProfileId={state.selectedProfileId}
        sensorEntitiesInput={state.sensorEntitiesInput}
        setAvailabilityEntitiesInput={state.setAvailabilityEntitiesInput}
        setDryRun={state.setDryRun}
        setIncludeAllNumericSensors={state.setIncludeAllNumericSensors}
        setIsDeleteProfileDialogOpen={state.setIsDeleteProfileDialogOpen}
        setProfileDescriptionInput={state.setProfileDescriptionInput}
        setProfileNameInput={state.setProfileNameInput}
        setSelectedEquipmentId={state.setSelectedEquipmentId}
        setSelectedLocationId={state.setSelectedLocationId}
        setSensorEntitiesInput={state.setSensorEntitiesInput}
        setSource={state.setSource}
        showBatchAmbiguityWarning={state.showBatchAmbiguityWarning}
        sortedFlowNodes={state.sortedFlowNodes}
        source={state.source}
        syncMutation={state.syncMutation}
        syncProfileStoreLoading={state.syncProfileStoreLoading}
      />

      <IotEntityLinksTable
        entityLinks={state.entityLinks}
        equipment={state.equipment}
        locations={state.locations}
        trackedEntities={state.trackedEntities}
        updateEntityLink={state.updateEntityLink}
      />

      <IotSensorChart
        chartReadings={state.chartReadings}
        chartSensorCodes={state.chartSensorCodes}
        latestReadings={state.latestReadings}
        readingsLoading={state.readingsLoading}
        selectedReadingType={state.selectedReadingType}
        selectedSensorCode={state.selectedSensorCode}
        setSelectedReadingType={state.setSelectedReadingType}
        setSelectedSensorCode={state.setSelectedSensorCode}
      />

      <AlertDialog
        open={state.isDeleteProfileDialogOpen}
        onOpenChange={state.setIsDeleteProfileDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.production.flow.iot.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.production.flow.iot.deleteDialog.description", {
                name: state.selectedProfileDisplayName,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("admin.production.flow.iot.deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={state.handleDeleteProfile}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("admin.production.flow.iot.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
