import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchHomeAssistantSyncProfile,
  fetchHomeAssistantSyncProfileStore,
  fetchHomeAssistantHealth,
  saveHomeAssistantSyncProfile,
  saveHomeAssistantSyncProfileStore,
  syncHomeAssistantProductionData,
} from "@/hooks/useHomeAssistantProductionSync";

const hoisted = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  rpcMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    functions: {
      invoke: (...args: unknown[]) => hoisted.invokeMock(...args),
    },
    rpc: (...args: unknown[]) => hoisted.rpcMock(...args),
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: hoisted.safeErrorMock,
  };
});

describe("useHomeAssistantProductionSync helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches Home Assistant health data via edge function", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: {
        config: {
          location_name: "Factory Alpha",
          time_zone: "Europe/Prague",
        },
        ha_version: "2026.2.0",
        success: true,
        transport: "websocket",
      },
      error: null,
    });

    const response = await fetchHomeAssistantHealth();

    expect(response.success).toBe(true);
    expect(response.transport).toBe("websocket");
    expect(hoisted.invokeMock).toHaveBeenCalledWith("homeassistant-api", {
      body: {
        action: "health",
      },
    });
  });

  it("normalizes sync payload and parses sync response", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: {
        dry_run: true,
        ha_version: "2026.2.0",
        skipped: {
          availability: [],
          sensors: [],
        },
        success: true,
        summary: {
          availability: {
            online_count: 2,
            online_rate_pct: 100,
            processed_count: 2,
            requested_count: 2,
            skipped_count: 0,
          },
          links: {
            applied_count: 1,
            configured_count: 1,
          },
          sensors: {
            processed_count: 2,
            requested_count: 2,
            skipped_count: 0,
          },
          states_fetched: 120,
          transport: "websocket",
        },
      },
      error: null,
    });

    const response = await syncHomeAssistantProductionData({
      availabilityEntities: ["binary_sensor.packaging_line_online", " binary_sensor.packaging_line_online "],
      dryRun: true,
      includeAllNumericSensors: false,
      mappingProfile: {
        flowNodeId: "69da491d-7dd8-4e2c-9b82-127dc5110daf",
        id: "dryer-v2-night-shift",
        name: "Dryer V2 / Night shift",
      },
      sensorEntities: ["sensor.packaging_temp", " sensor.packaging_temp ", "sensor.packaging_humidity"],
      entityLinks: {
        "sensor.packaging_temp": {
          equipmentId: "1f4a4583-4376-47b8-946b-86d9d81ff09b",
          locationId: "84640a93-9048-4635-87b2-d249f55d2c68",
          readingType: "temperature",
          sensorCode: "PACK-TEMP-1",
          unit: "°C",
        },
      },
      thresholds: {
        "sensor.packaging_temp": { max: 25, min: 18, warnMarginPct: 5 },
      },
    });

    expect(response.success).toBe(true);
    expect(response.summary.sensors.processed_count).toBe(2);
    expect(hoisted.invokeMock).toHaveBeenCalledWith(
      "homeassistant-api",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "sync_production_data",
          availability_entities: ["binary_sensor.packaging_line_online"],
          entity_links: {
            "sensor.packaging_temp": {
              equipment_id: "1f4a4583-4376-47b8-946b-86d9d81ff09b",
              location_id: "84640a93-9048-4635-87b2-d249f55d2c68",
              reading_type: "temperature",
              sensor_code: "PACK-TEMP-1",
              unit: "°C",
            },
          },
          mapping_profile: {
            flow_node_id: "69da491d-7dd8-4e2c-9b82-127dc5110daf",
            id: "dryer-v2-night-shift",
            name: "Dryer V2 / Night shift",
          },
          sensor_entities: ["sensor.packaging_temp", "sensor.packaging_humidity"],
          thresholds: {
            "sensor.packaging_temp": {
              max: 25,
              min: 18,
              warn_margin_pct: 5,
            },
          },
        }),
      }),
    );
  });

  it("loads legacy profile and saves default profile wrapper", async () => {
    hoisted.rpcMock.mockResolvedValueOnce({
      data: {
        availabilityEntities: ["binary_sensor.mixer_online"],
        batchId: "bc7f2668-c0b0-4a06-af73-6ac2484840f9",
        dryRun: true,
        entityLinks: {
          "sensor.mixer_temp": {
            equipmentId: "dbd98987-69db-48c4-a8f8-657f6c78fc85",
            locationId: "e4b91831-148b-4872-86c8-023622788042",
            readingType: "temperature",
            sensorCode: "MIX-TEMP-01",
            unit: "°C",
          },
        },
        equipmentId: "dbd98987-69db-48c4-a8f8-657f6c78fc85",
        includeAllNumericSensors: false,
        locationId: "e4b91831-148b-4872-86c8-023622788042",
        sensorEntities: ["sensor.mixer_temp"],
        source: "homeassistant",
      },
      error: null,
    });

    const profile = await fetchHomeAssistantSyncProfile();
    expect(profile.sensorEntities).toEqual(["sensor.mixer_temp"]);
    expect(profile.entityLinks["sensor.mixer_temp"]?.sensorCode).toBe("MIX-TEMP-01");

    hoisted.rpcMock.mockResolvedValueOnce({
      data: { success: true },
      error: null,
    });
    hoisted.rpcMock.mockResolvedValueOnce({
      data: {
        updated_at: "2026-02-13T13:10:00.000Z",
        value: {
          activeProfileId: "default",
          profiles: [
            {
              config: {
                availabilityEntities: ["binary_sensor.mixer_online"],
                batchId: "bc7f2668-c0b0-4a06-af73-6ac2484840f9",
                dryRun: true,
                entityLinks: {
                  "sensor.mixer_temp": {
                    equipmentId: "dbd98987-69db-48c4-a8f8-657f6c78fc85",
                    locationId: "e4b91831-148b-4872-86c8-023622788042",
                    readingType: "temperature",
                    sensorCode: "MIX-TEMP-01",
                    unit: "°C",
                  },
                },
                equipmentId: "dbd98987-69db-48c4-a8f8-657f6c78fc85",
                includeAllNumericSensors: false,
                locationId: "e4b91831-148b-4872-86c8-023622788042",
                sensorEntities: ["sensor.mixer_temp"],
                source: "homeassistant",
              },
              description: null,
              flowNodeId: null,
              id: "default",
              name: "Default profile",
              updatedAt: "2026-02-13T13:10:00.000Z",
            },
          ],
          version: 1,
        },
      },
      error: null,
    });

    await saveHomeAssistantSyncProfile(profile);

    expect(hoisted.rpcMock).toHaveBeenNthCalledWith(1, "get_system_config", {
      p_key: "homeassistant_production_sync_profile",
      p_with_meta: true,
    });

    expect(hoisted.rpcMock).toHaveBeenNthCalledWith(
      2,
      "set_system_config_admin",
      expect.objectContaining({
        p_category: "integrations",
        p_description: "Home Assistant production sync profile store",
        p_expected_updated_at: undefined,
        p_is_public: false,
        p_key: "homeassistant_production_sync_profile",
        p_value: expect.objectContaining({
          activeProfileId: "default",
          profiles: [
            expect.objectContaining({
              flowNodeId: null,
              id: "default",
              name: "Default profile",
            }),
          ],
        }),
      }),
    );
    expect(hoisted.rpcMock).toHaveBeenNthCalledWith(3, "get_system_config", {
      p_key: "homeassistant_production_sync_profile",
      p_with_meta: true,
    });
  });

  it("loads and saves named profile store through system_config RPC", async () => {
    hoisted.rpcMock.mockResolvedValueOnce({
      data: {
        updated_at: "2026-02-13T09:12:10.000Z",
        value: {
          activeProfileId: "dryer-v2",
          profiles: [
            {
              config: {
                availabilityEntities: ["binary_sensor.dryer_v2_online"],
                batchId: null,
                dryRun: false,
                entityLinks: {
                  "sensor.dryer_v2_temp": {
                    readingType: "temperature",
                    sensorCode: "DRYER-V2-T1",
                    unit: "°C",
                  },
                },
                equipmentId: "842f2c47-9cae-42c2-9eec-318622f014d8",
                includeAllNumericSensors: false,
                locationId: null,
                sensorEntities: ["sensor.dryer_v2_temp"],
                source: "homeassistant",
              },
              description: "Dryer V2 baseline profile",
              flowNodeId: "f9c8f51a-e8da-4f6c-8866-4a81ec2d71fa",
              id: "dryer-v2",
              name: "Dryer V2",
              updatedAt: "2026-02-13T09:12:10.000Z",
            },
          ],
          version: 1,
        },
      },
      error: null,
    });

    const store = await fetchHomeAssistantSyncProfileStore();
    expect(store.activeProfileId).toBe("dryer-v2");
    expect(store.profiles[0]?.flowNodeId).toBe("f9c8f51a-e8da-4f6c-8866-4a81ec2d71fa");

    hoisted.rpcMock.mockResolvedValueOnce({
      data: { success: true },
      error: null,
    });
    hoisted.rpcMock.mockResolvedValueOnce({
      data: {
        updated_at: "2026-02-13T09:15:12.000Z",
        value: {
          activeProfileId: "dryer-v2",
          profiles: [
            {
              config: {
                availabilityEntities: ["binary_sensor.dryer_v2_online"],
                batchId: null,
                dryRun: false,
                entityLinks: {
                  "sensor.dryer_v2_temp": {
                    readingType: "temperature",
                    sensorCode: "DRYER-V2-T1",
                    unit: "°C",
                  },
                },
                equipmentId: "842f2c47-9cae-42c2-9eec-318622f014d8",
                includeAllNumericSensors: false,
                locationId: null,
                sensorEntities: ["sensor.dryer_v2_temp"],
                source: "homeassistant",
              },
              description: "Dryer V2 baseline profile",
              flowNodeId: "f9c8f51a-e8da-4f6c-8866-4a81ec2d71fa",
              id: "dryer-v2",
              name: "Dryer V2",
              updatedAt: "2026-02-13T09:12:10.000Z",
            },
          ],
          version: 1,
        },
      },
      error: null,
    });

    await saveHomeAssistantSyncProfileStore({
      expectedUpdatedAt: "2026-02-13T09:12:10.000Z",
      store,
    });

    expect(hoisted.rpcMock).toHaveBeenNthCalledWith(1, "get_system_config", {
      p_key: "homeassistant_production_sync_profile",
      p_with_meta: true,
    });
    expect(hoisted.rpcMock).toHaveBeenNthCalledWith(
      2,
      "set_system_config_admin",
      expect.objectContaining({
        p_category: "integrations",
        p_description: "Home Assistant production sync profile store",
        p_expected_updated_at: "2026-02-13T09:12:10.000Z",
        p_is_public: false,
        p_key: "homeassistant_production_sync_profile",
        p_value: expect.objectContaining({
          activeProfileId: "dryer-v2",
          version: 1,
        }),
      }),
    );
    expect(hoisted.rpcMock).toHaveBeenNthCalledWith(3, "get_system_config", {
      p_key: "homeassistant_production_sync_profile",
      p_with_meta: true,
    });
  });

  it("logs and throws when edge invoke fails", async () => {
    const invokeError = new Error("Edge invoke failed");
    hoisted.invokeMock.mockResolvedValue({
      data: null,
      error: invokeError,
    });

    await expect(fetchHomeAssistantHealth()).rejects.toThrow("Edge invoke failed");
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "homeAssistant.health.invokeFailed",
      invokeError,
    );
  });
});
