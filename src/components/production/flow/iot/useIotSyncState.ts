/**
 * @fileoverview Custom hook managing all IoT sync state, queries, mutations,
 * and event handlers for FlowIotIntegrationSection.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useProductionBatchesAdmin,
  useProductionEquipmentAdmin,
  useProductionLocationsAdmin,
  useProductionSensorReadingsAdmin,
  useFlowNodesAdmin,
  useLatestBatchForFlowNodeAdmin,
  useHomeAssistantHealthCheck,
  useHomeAssistantSyncProfileStoreSnapshot,
  useSaveHomeAssistantSyncProfileStore,
  useHomeAssistantProductionSync,
  type HomeAssistantEntityLink,
  type HomeAssistantProductionSyncProfile,
  type HomeAssistantSyncProfileTemplate,
} from "@/hooks";

import {
  ALL_READING_TYPES_VALUE,
  NONE_OPTION_VALUE,
  NEW_PROFILE_VALUE,
  buildUniqueProfileId,
  isSystemConfigConflictError,
  normalizeEntityLinkInput,
  optionalValue,
  parseEntityList,
  type SyncSource,
} from "./iotUtils";

/** Return type of {@link useIotSyncState}. */
export interface IotSyncStateReturn {
  // ---- queries ----
  batches: ReturnType<typeof useProductionBatchesAdmin>["data"];
  chartReadings: { recordedAt: string; value: number }[];
  chartSensorCodes: string[];
  effectiveSensorCode: string | null;
  equipment: ReturnType<typeof useProductionEquipmentAdmin>["data"];
  flowNodeBatchCandidateCount: number;
  health: ReturnType<typeof useHomeAssistantHealthCheck>["data"];
  healthLoading: boolean;
  latestReadings: NonNullable<ReturnType<typeof useProductionSensorReadingsAdmin>["data"]>;
  locations: ReturnType<typeof useProductionLocationsAdmin>["data"];
  readingsLoading: boolean;
  sortedFlowNodes: NonNullable<ReturnType<typeof useFlowNodesAdmin>["data"]>;
  syncMutation: ReturnType<typeof useHomeAssistantProductionSync>;

  // ---- form state ----
  availabilityEntitiesInput: string;
  availableProfiles: HomeAssistantSyncProfileTemplate[];
  dryRun: boolean;
  entityLinks: Record<string, HomeAssistantEntityLink>;
  includeAllNumericSensors: boolean;
  isBatchAutoFilled: boolean;
  isDeleteProfileDialogOpen: boolean;
  profileDescriptionInput: string;
  profileNameInput: string;
  saveSyncProfileStoreMutation: ReturnType<typeof useSaveHomeAssistantSyncProfileStore>;
  selectedBatchId: string;
  selectedEquipmentId: string;
  selectedFlowNodeId: string;
  selectedFlowNodeLabel: string | null;
  selectedLocationId: string;
  selectedProfileDisplayName: string;
  selectedProfileId: string;
  selectedReadingType: string;
  selectedSensorCode: string;
  sensorEntitiesInput: string;
  showBatchAmbiguityWarning: boolean;
  source: SyncSource;
  syncProfileStoreLoading: boolean;
  trackedEntities: string[];

  // ---- handlers ----
  handleBatchSelectionChange: (nextBatchId: string) => void;
  handleDeleteProfile: () => Promise<void>;
  handleFlowNodeSelectionChange: (nextFlowNodeId: string) => void;
  handleLoadProfile: () => Promise<void>;
  handleProfileSelectionChange: (nextProfileId: string) => void;
  handleSaveProfile: () => Promise<void>;
  handleSync: () => void;
  refetchHealth: () => void;
  setAvailabilityEntitiesInput: (value: string) => void;
  setDryRun: (value: boolean) => void;
  setIncludeAllNumericSensors: (value: boolean) => void;
  setIsDeleteProfileDialogOpen: (open: boolean) => void;
  setProfileDescriptionInput: (value: string) => void;
  setProfileNameInput: (value: string) => void;
  setSelectedEquipmentId: (value: string) => void;
  setSelectedLocationId: (value: string) => void;
  setSelectedReadingType: (value: string) => void;
  setSelectedSensorCode: (value: string) => void;
  setSensorEntitiesInput: (value: string) => void;
  setSource: (value: SyncSource) => void;
  updateEntityLink: (entityId: string, patch: Partial<HomeAssistantEntityLink>) => void;
}

/**
 * Hook encapsulating all IoT integration state — queries, form state,
 * profile management, and sync execution.
 */
export function useIotSyncState(): IotSyncStateReturn {
  const { t } = useTranslation();

  // ---- form state ----
  const [source, setSource] = useState<SyncSource>("homeassistant");
  const [sensorEntitiesInput, setSensorEntitiesInput] = useState("");
  const [availabilityEntitiesInput, setAvailabilityEntitiesInput] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<string>(NONE_OPTION_VALUE);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>(NONE_OPTION_VALUE);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(NONE_OPTION_VALUE);
  const [selectedFlowNodeId, setSelectedFlowNodeId] = useState<string>(NONE_OPTION_VALUE);
  const [includeAllNumericSensors, setIncludeAllNumericSensors] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [profileStoreInitialized, setProfileStoreInitialized] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(NEW_PROFILE_VALUE);
  const [profileNameInput, setProfileNameInput] = useState("");
  const [profileDescriptionInput, setProfileDescriptionInput] = useState("");
  const [entityLinks, setEntityLinks] = useState<Record<string, HomeAssistantEntityLink>>({});
  const [isDeleteProfileDialogOpen, setIsDeleteProfileDialogOpen] = useState(false);
  const [isBatchAutoFilled, setIsBatchAutoFilled] = useState(false);
  const [selectedReadingType, setSelectedReadingType] = useState<string>("temperature");
  const [selectedSensorCode, setSelectedSensorCode] = useState<string>(NONE_OPTION_VALUE);

  // ---- queries / mutations ----
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } =
    useHomeAssistantHealthCheck(true);
  const {
    data: syncProfileStoreSnapshot,
    isLoading: syncProfileStoreLoading,
    refetch: refetchSyncProfileStore,
  } = useHomeAssistantSyncProfileStoreSnapshot(true);
  const saveSyncProfileStoreMutation = useSaveHomeAssistantSyncProfileStore();
  const syncMutation = useHomeAssistantProductionSync();

  const { data: batches } = useProductionBatchesAdmin();
  const { data: equipment } = useProductionEquipmentAdmin();
  const { data: locations } = useProductionLocationsAdmin();
  const { data: flowNodes } = useFlowNodesAdmin({ is_active: true });

  // ---- derived values ----
  const selectedBatchFilter = optionalValue(selectedBatchId);
  const selectedEquipmentFilter = optionalValue(selectedEquipmentId);
  const selectedLocationFilter = optionalValue(selectedLocationId);
  const selectedFlowNodeFilter = optionalValue(selectedFlowNodeId);
  const syncProfileStore = syncProfileStoreSnapshot?.store;
  const { data: batchSuggestion } = useLatestBatchForFlowNodeAdmin(selectedFlowNodeFilter);
  const latestNodeBatchId = batchSuggestion?.suggestedBatchId ?? null;
  const flowNodeBatchCandidateCount = batchSuggestion?.candidateCount ?? 0;
  const selectedReadingTypeFilter =
    selectedReadingType === ALL_READING_TYPES_VALUE
      ? undefined
      : selectedReadingType;

  const { data: recentReadings, isLoading: readingsLoading } =
    useProductionSensorReadingsAdmin({
      batch_id: selectedBatchFilter,
      equipment_id: selectedEquipmentFilter,
      limit: 300,
      location_id: selectedLocationFilter,
      reading_type: selectedReadingTypeFilter,
    });

  const sensorEntities = useMemo(
    () => parseEntityList(sensorEntitiesInput),
    [sensorEntitiesInput],
  );
  const availabilityEntities = useMemo(
    () => parseEntityList(availabilityEntitiesInput),
    [availabilityEntitiesInput],
  );
  const trackedEntities = useMemo(
    () => Array.from(new Set([...sensorEntities, ...availabilityEntities])),
    [availabilityEntities, sensorEntities],
  );
  const availableProfiles = useMemo(
    () => syncProfileStore?.profiles ?? [],
    [syncProfileStore],
  );
  const sortedFlowNodes = useMemo(
    () =>
      (flowNodes ?? [])
        .slice()
        .sort((first, second) => first.node_name.localeCompare(second.node_name)),
    [flowNodes],
  );
  const selectedFlowNodeLabel = useMemo(() => {
    if (!selectedFlowNodeFilter) return null;
    const flowNode = sortedFlowNodes.find((node) => node.id === selectedFlowNodeFilter);
    if (!flowNode) return null;
    return `${flowNode.node_code} — ${flowNode.node_name}`;
  }, [selectedFlowNodeFilter, sortedFlowNodes]);
  const showBatchAmbiguityWarning =
    selectedFlowNodeFilter != null && flowNodeBatchCandidateCount > 1;
  const selectedProfileDisplayName =
    profileNameInput.trim().length > 0
      ? profileNameInput.trim()
      : t("admin.production.flow.iot.profiles.unnamedProfile");

  const chartSensorCodes = useMemo(
    () =>
      Array.from(
        new Set((recentReadings ?? []).map((reading) => reading.sensor_code)),
      ).sort((first, second) => first.localeCompare(second)),
    [recentReadings],
  );

  const effectiveSensorCode =
    selectedSensorCode !== NONE_OPTION_VALUE
      ? selectedSensorCode
      : chartSensorCodes[0] ?? null;

  const chartReadings = useMemo(() => {
    if (!effectiveSensorCode) return [];
    return (recentReadings ?? [])
      .filter((reading) => reading.sensor_code === effectiveSensorCode)
      .sort(
        (first, second) =>
          new Date(first.recorded_at).getTime() -
          new Date(second.recorded_at).getTime(),
      )
      .slice(-160)
      .map((reading) => ({
        recordedAt: new Date(reading.recorded_at).toLocaleString(),
        value: reading.value,
      }));
  }, [effectiveSensorCode, recentReadings]);

  const latestReadings = useMemo(() => {
    if (!effectiveSensorCode) return [];
    return (recentReadings ?? [])
      .filter((reading) => reading.sensor_code === effectiveSensorCode)
      .sort(
        (first, second) =>
          new Date(second.recorded_at).getTime() -
          new Date(first.recorded_at).getTime(),
      )
      .slice(0, 8);
  }, [effectiveSensorCode, recentReadings]);

  // ---- profile helpers ----
  const applyProfileToForm = useCallback(
    (profile: HomeAssistantProductionSyncProfile) => {
      setSource(profile.source);
      setSensorEntitiesInput(profile.sensorEntities.join("\n"));
      setAvailabilityEntitiesInput(profile.availabilityEntities.join("\n"));
      setSelectedBatchId(profile.batchId ?? NONE_OPTION_VALUE);
      setIsBatchAutoFilled(false);
      setSelectedEquipmentId(profile.equipmentId ?? NONE_OPTION_VALUE);
      setSelectedLocationId(profile.locationId ?? NONE_OPTION_VALUE);
      setIncludeAllNumericSensors(profile.includeAllNumericSensors);
      setDryRun(profile.dryRun);
      setEntityLinks(profile.entityLinks);
    },
    [],
  );

  const loadProfileTemplate = useCallback(
    (profileTemplate: HomeAssistantSyncProfileTemplate) => {
      applyProfileToForm(profileTemplate.config);
      setSelectedProfileId(profileTemplate.id);
      setProfileNameInput(profileTemplate.name);
      setProfileDescriptionInput(profileTemplate.description ?? "");
      setSelectedFlowNodeId(profileTemplate.flowNodeId ?? NONE_OPTION_VALUE);
    },
    [applyProfileToForm],
  );

  // ---- effects ----
  useEffect(() => {
    if (!syncProfileStore || profileStoreInitialized) return;

    const activeProfile =
      (syncProfileStore.activeProfileId
        ? syncProfileStore.profiles.find(
          (profile) => profile.id === syncProfileStore.activeProfileId,
        )
        : null) ??
      syncProfileStore.profiles[0];

    if (activeProfile) {
      loadProfileTemplate(activeProfile);
    } else {
      setSelectedProfileId(NEW_PROFILE_VALUE);
      setProfileNameInput("");
      setProfileDescriptionInput("");
      setSelectedFlowNodeId(NONE_OPTION_VALUE);
    }

    setProfileStoreInitialized(true);
  }, [loadProfileTemplate, profileStoreInitialized, syncProfileStore]);

  useEffect(() => {
    if (selectedFlowNodeId === NONE_OPTION_VALUE) return;

    const flowNode = sortedFlowNodes.find((node) => node.id === selectedFlowNodeId);
    if (!flowNode) return;

    if (
      selectedEquipmentId === NONE_OPTION_VALUE &&
      flowNode.equipment_id
    ) {
      setSelectedEquipmentId(flowNode.equipment_id);
    }

    if (
      selectedLocationId === NONE_OPTION_VALUE &&
      flowNode.location_id
    ) {
      setSelectedLocationId(flowNode.location_id);
    }
  }, [
    selectedEquipmentId,
    selectedFlowNodeId,
    selectedLocationId,
    sortedFlowNodes,
  ]);

  useEffect(() => {
    if (selectedBatchId !== NONE_OPTION_VALUE) return;
    if (!latestNodeBatchId) {
      setIsBatchAutoFilled(false);
      return;
    }
    setSelectedBatchId(latestNodeBatchId);
    setIsBatchAutoFilled(true);
  }, [latestNodeBatchId, selectedBatchId]);

  // ---- handlers ----
  const handleBatchSelectionChange = (nextBatchId: string) => {
    setSelectedBatchId(nextBatchId);
    setIsBatchAutoFilled(false);
  };

  const handleFlowNodeSelectionChange = (nextFlowNodeId: string) => {
    setSelectedFlowNodeId(nextFlowNodeId);
    setIsBatchAutoFilled(false);
    if (nextFlowNodeId === NONE_OPTION_VALUE) return;

    const flowNode = sortedFlowNodes.find((node) => node.id === nextFlowNodeId);
    if (!flowNode) return;

    if (flowNode.equipment_id) {
      setSelectedEquipmentId(flowNode.equipment_id);
    }
    if (flowNode.location_id) {
      setSelectedLocationId(flowNode.location_id);
    }
  };

  const handleProfileSelectionChange = (nextProfileId: string) => {
    setSelectedProfileId(nextProfileId);

    if (nextProfileId === NEW_PROFILE_VALUE) {
      setProfileNameInput("");
      setProfileDescriptionInput("");
      setSelectedFlowNodeId(NONE_OPTION_VALUE);
      return;
    }

    const profileTemplate = availableProfiles.find((profile) => profile.id === nextProfileId);
    if (!profileTemplate) return;

    loadProfileTemplate(profileTemplate);
  };

  const updateEntityLink = (
    entityId: string,
    patch: Partial<HomeAssistantEntityLink>,
  ) => {
    setEntityLinks((previous) => {
      const current = previous[entityId] ?? {};
      const next: HomeAssistantEntityLink = {
        ...current,
        ...patch,
      };

      if (
        !next.equipmentId &&
        !next.locationId &&
        !next.readingType &&
        !next.sensorCode &&
        !next.unit
      ) {
        const reduced = { ...previous };
        delete reduced[entityId];
        return reduced;
      }

      return {
        ...previous,
        [entityId]: next,
      };
    });
  };

  const handleSync = () => {
    if (
      sensorEntities.length === 0 &&
      availabilityEntities.length === 0 &&
      !includeAllNumericSensors
    ) {
      toast.error(t("admin.production.flow.iot.toast.noEntities"));
      return;
    }

    const trimmedProfileName = profileNameInput.trim();
    const mappingProfileId =
      selectedProfileId !== NEW_PROFILE_VALUE ? selectedProfileId : undefined;
    const mappingProfile =
      mappingProfileId || trimmedProfileName || selectedFlowNodeFilter
        ? {
          flowNodeId: selectedFlowNodeFilter,
          id: mappingProfileId,
          name: trimmedProfileName.length > 0 ? trimmedProfileName : undefined,
        }
        : undefined;

    syncMutation.mutate(
      {
        availabilityEntities:
          availabilityEntities.length > 0 ? availabilityEntities : undefined,
        batchId: selectedBatchFilter,
        dryRun,
        entityLinks: normalizeEntityLinkInput(entityLinks, trackedEntities),
        equipmentId: selectedEquipmentFilter,
        includeAllNumericSensors,
        locationId: selectedLocationFilter,
        mappingProfile,
        maxEntities: 500,
        persistAvailability: true,
        sensorEntities: sensorEntities.length > 0 ? sensorEntities : undefined,
        source,
      },
      {
        onError: () => {
          toast.error(t("admin.production.flow.iot.toast.syncFailed"));
        },
        onSuccess: (result) => {
          toast.success(
            t("admin.production.flow.iot.toast.syncSuccess", {
              availability: result.summary.availability.processed_count,
              sensors: result.summary.sensors.processed_count,
            }),
          );
        },
      },
    );
  };

  const handleSaveProfile = async () => {
    const normalizedProfileName = profileNameInput.trim();
    if (normalizedProfileName.length === 0) {
      toast.error(t("admin.production.flow.iot.toast.profileNameRequired"));
      return;
    }

    const refreshedStoreResponse = await refetchSyncProfileStore();
    const latestSnapshot = refreshedStoreResponse.data;
    if (!latestSnapshot) {
      toast.error(t("admin.production.flow.iot.toast.profileSaveFailed"));
      return;
    }
    const latestStore = latestSnapshot.store;

    const existingProfiles = latestStore.profiles;
    const targetProfileId =
      selectedProfileId === NEW_PROFILE_VALUE
        ? buildUniqueProfileId(normalizedProfileName, existingProfiles)
        : selectedProfileId;

    const nextTemplate: HomeAssistantSyncProfileTemplate = {
      config: {
        availabilityEntities,
        batchId: selectedBatchFilter ?? null,
        dryRun,
        entityLinks,
        equipmentId: selectedEquipmentFilter ?? null,
        includeAllNumericSensors,
        locationId: selectedLocationFilter ?? null,
        sensorEntities,
        source,
      },
      description: profileDescriptionInput.trim() || null,
      flowNodeId: selectedFlowNodeFilter ?? null,
      id: targetProfileId,
      name: normalizedProfileName,
      updatedAt: new Date().toISOString(),
    };

    const existingProfileIndex = existingProfiles.findIndex(
      (profile) => profile.id === targetProfileId,
    );
    const nextProfiles =
      existingProfileIndex >= 0
        ? existingProfiles.map((profile, profileIndex) =>
          profileIndex === existingProfileIndex ? nextTemplate : profile,
        )
        : [...existingProfiles, nextTemplate];

    try {
      const savedStore = await saveSyncProfileStoreMutation.mutateAsync({
        expectedUpdatedAt: latestSnapshot.updatedAt,
        store: {
          activeProfileId: targetProfileId,
          profiles: nextProfiles,
          version: latestStore.version,
        },
      });

      const activeTemplate =
        savedStore.store.activeProfileId
          ? savedStore.store.profiles.find(
            (profile) => profile.id === savedStore.store.activeProfileId,
          )
          : null;
      const savedTemplate =
        activeTemplate ??
        savedStore.store.profiles.find((profile) => profile.id === targetProfileId) ??
        nextTemplate;
      loadProfileTemplate(savedTemplate);
      setProfileStoreInitialized(true);
      toast.success(t("admin.production.flow.iot.toast.profileSaved"));
    } catch (error: unknown) {
      toast.error(
        isSystemConfigConflictError(error)
          ? t("admin.production.flow.iot.toast.profileConflict")
          : t("admin.production.flow.iot.toast.profileSaveFailed"),
      );
    }
  };

  const handleLoadProfile = async () => {
    const response = await refetchSyncProfileStore();
    const refreshedSnapshot = response.data;
    const refreshedStore = refreshedSnapshot?.store;

    if (!refreshedStore) {
      toast.error(t("admin.production.flow.iot.toast.profileLoadFailed"));
      return;
    }

    const selectedTemplate =
      selectedProfileId !== NEW_PROFILE_VALUE
        ? refreshedStore.profiles.find((profile) => profile.id === selectedProfileId)
        : null;
    const activeTemplate =
      (refreshedStore.activeProfileId
        ? refreshedStore.profiles.find(
          (profile) => profile.id === refreshedStore.activeProfileId,
        )
        : null) ?? refreshedStore.profiles[0];

    const profileToLoad = selectedTemplate ?? activeTemplate;
    if (!profileToLoad) {
      toast.error(t("admin.production.flow.iot.toast.profileLoadFailed"));
      return;
    }

    loadProfileTemplate(profileToLoad);
    setProfileStoreInitialized(true);
    toast.success(t("admin.production.flow.iot.toast.profileLoaded"));
  };

  const handleDeleteProfile = async () => {
    if (selectedProfileId === NEW_PROFILE_VALUE) {
      toast.error(t("admin.production.flow.iot.toast.profileDeleteFailed"));
      return;
    }

    const refreshedStoreResponse = await refetchSyncProfileStore();
    const latestSnapshot = refreshedStoreResponse.data;
    if (!latestSnapshot) {
      toast.error(t("admin.production.flow.iot.toast.profileDeleteFailed"));
      return;
    }
    const latestStore = latestSnapshot.store;

    const existingProfiles = latestStore.profiles;
    const nextProfiles = existingProfiles.filter(
      (profile) => profile.id !== selectedProfileId,
    );

    if (nextProfiles.length === existingProfiles.length) {
      toast.error(t("admin.production.flow.iot.toast.profileDeleteFailed"));
      return;
    }

    const nextActiveProfileId = nextProfiles[0]?.id ?? null;

    try {
      const savedStore = await saveSyncProfileStoreMutation.mutateAsync({
        expectedUpdatedAt: latestSnapshot.updatedAt,
        store: {
          activeProfileId: nextActiveProfileId,
          profiles: nextProfiles,
          version: latestStore.version,
        },
      });

      const nextActiveTemplate =
        savedStore.store.activeProfileId
          ? savedStore.store.profiles.find(
            (profile) => profile.id === savedStore.store.activeProfileId,
          )
          : null;

      if (nextActiveTemplate) {
        loadProfileTemplate(nextActiveTemplate);
      } else {
        setSelectedProfileId(NEW_PROFILE_VALUE);
        setProfileNameInput("");
        setProfileDescriptionInput("");
        setSelectedFlowNodeId(NONE_OPTION_VALUE);
      }

      setProfileStoreInitialized(true);
      toast.success(t("admin.production.flow.iot.toast.profileDeleted"));
    } catch (error: unknown) {
      toast.error(
        isSystemConfigConflictError(error)
          ? t("admin.production.flow.iot.toast.profileConflict")
          : t("admin.production.flow.iot.toast.profileDeleteFailed"),
      );
    }
  };

  return {
    availabilityEntitiesInput,
    availableProfiles,
    batches,
    chartReadings,
    chartSensorCodes,
    dryRun,
    effectiveSensorCode,
    entityLinks,
    equipment,
    flowNodeBatchCandidateCount,
    handleBatchSelectionChange,
    handleDeleteProfile,
    handleFlowNodeSelectionChange,
    handleLoadProfile,
    handleProfileSelectionChange,
    handleSaveProfile,
    handleSync,
    health,
    healthLoading,
    includeAllNumericSensors,
    isBatchAutoFilled,
    isDeleteProfileDialogOpen,
    latestReadings,
    locations,
    profileDescriptionInput,
    profileNameInput,
    readingsLoading,
    refetchHealth: () => void refetchHealth(),
    saveSyncProfileStoreMutation,
    selectedBatchId,
    selectedEquipmentId,
    selectedFlowNodeId,
    selectedFlowNodeLabel,
    selectedLocationId,
    selectedProfileDisplayName,
    selectedProfileId,
    selectedReadingType,
    selectedSensorCode,
    sensorEntitiesInput,
    setAvailabilityEntitiesInput,
    setDryRun,
    setIncludeAllNumericSensors,
    setIsDeleteProfileDialogOpen,
    setProfileDescriptionInput,
    setProfileNameInput,
    setSelectedEquipmentId,
    setSelectedLocationId,
    setSelectedReadingType,
    setSelectedSensorCode,
    setSensorEntitiesInput,
    setSource,
    showBatchAmbiguityWarning,
    sortedFlowNodes,
    source,
    syncMutation,
    syncProfileStoreLoading,
    trackedEntities,
    updateEntityLink,
  };
}
