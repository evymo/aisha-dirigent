import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { useAvailableShippingMethods } from "@/hooks/useAvailableShippingMethods";

// ── Hoisted mocks ──────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  safeErrorMock: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => ({
  isUsingAishaDevFallback: false,
  aisha: {
    functions: {
      invoke: (...args: unknown[]) => hoisted.invokeMock(...args),
    },
  },
}));

vi.mock("@/lib/security/safeLogger", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/security/safeLogger")>();
  return {
    ...actual,
    safeError: hoisted.safeErrorMock,
  };
});

// ── Wrapper ────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ── Valid response matching availableMethodsResponseSchema ──────

const validResponse = {
  carrierPickupPoints: [],
  carriers: [
    {
      country: "CZ",
      deliveryType: "HD",
      disallowsCod: false,
      displayName: "Zásilkovna domů",
      id: 106,
      maxWeight: 10,
      name: "CZ Zásilkovna domů HD",
      requiresEmail: false,
      requiresPhone: true,
    },
  ],
  costs: {
    carrier_home: 99,
    carrier_pickup: 89,
    packeta_home: 99,
    packeta_pickup: 79,
    packeta_zbox: 59,
    personal_pickup: 0,
  },
  freeShippingThreshold: 1500,
  personalPickupAvailable: true,
  pickupPoints: [
    {
      city: "Praha",
      codAllowed: true,
      country: "CZ",
      creditCardPayment: false,
      distance: 1.2,
      id: 1001,
      latitude: 50.08,
      longitude: 14.43,
      maxWeight: 10,
      name: "Praha 1 — Vodičkova",
      openingHours: "Po-Pá 8:00-20:00",
      photos: [],
      street: "Vodičkova 30",
      type: "branch",
      wheelchairAccessible: true,
      zip: "11000",
    },
  ],
  totalBranchCount: 1200,
  totalZboxCount: 800,
  zboxes: [
    {
      city: "Praha",
      country: "CZ",
      creditCardPayment: false,
      hasKeypad: true,
      id: 5001,
      latitude: 50.07,
      longitude: 14.42,
      maxWeight: 20,
      name: "Z-BOX Praha Karlín",
      photos: [],
      street: "Karlínské nám 1",
      type: "zbox",
      wheelchairAccessible: false,
      zip: "18600",
    },
  ],
};

// ── Tests ──────────────────────────────────────────────────────

describe("useAvailableShippingMethods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch and validate available methods", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: validResponse,
      error: null,
    });

    const { result } = renderHook(
      () =>
        useAvailableShippingMethods({
          country: "CZ",
          currency: "CZK",
          orderSubtotal: 500,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pickupPoints).toHaveLength(1);
    expect(result.current.data?.zboxes).toHaveLength(1);
    expect(result.current.data?.carriers).toHaveLength(1);
    expect(result.current.data?.costs.packeta_pickup).toBe(79);
    expect(result.current.data?.freeShippingThreshold).toBe(1500);
    expect(result.current.data?.personalPickupAvailable).toBe(true);
    expect(result.current.data?.totalBranchCount).toBe(1200);

    expect(hoisted.invokeMock).toHaveBeenCalledWith("packeta-api", {
      body: {
        action: "available-methods",
        country: "CZ",
        currency: "CZK",
        latitude: undefined,
        longitude: undefined,
        maxResults: 20,
        orderSubtotal: 500,
        postalCode: "",
        weightGrams: 500,
      },
    });
  });

  it("should not fetch when country is empty", () => {
    const { result } = renderHook(
      () =>
        useAvailableShippingMethods({
          country: "",
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
    expect(hoisted.invokeMock).not.toHaveBeenCalled();
  });

  it("should not fetch when disabled", () => {
    const { result } = renderHook(
      () =>
        useAvailableShippingMethods({ country: "CZ" }, false),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
    expect(hoisted.invokeMock).not.toHaveBeenCalled();
  });

  it("should throw on invoke error", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: null,
      error: { message: "Edge function timeout" },
    });

    const { result } = renderHook(
      () =>
        useAvailableShippingMethods({ country: "CZ" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.error?.message).toBe("Edge function timeout");
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "shipping.availableMethods.fetchFailed",
      expect.anything(),
    );
  });

  it("should return EMPTY_RESPONSE and log when validation fails but structure is valid", async () => {
    // Response with extra fields/wrong types that fail Zod but still has "costs"
    const roughResponse = {
      ...validResponse,
      pickupPoints: [{ id: "string-id-invalid", name: "Test" }], // invalid type for id
    };

    hoisted.invokeMock.mockResolvedValue({
      data: roughResponse,
      error: null,
    });

    const { result } = renderHook(
      () =>
        useAvailableShippingMethods({ country: "CZ" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Zero-silent-degradation: returns EMPTY_RESPONSE instead of unsafe cast
    expect(result.current.data?.costs).toEqual({});
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "shipping.availableMethods.parseError",
      expect.objectContaining({ issues: expect.any(Number) }),
    );
    expect(hoisted.safeErrorMock).toHaveBeenCalledWith(
      "shipping.availableMethods.schemaDropped",
      expect.objectContaining({ raw_keys: expect.any(Array) }),
    );
  });

  it("should return EMPTY_RESPONSE when data is completely invalid", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: { invalid: true },
      error: null,
    });

    const { result } = renderHook(
      () =>
        useAvailableShippingMethods({ country: "CZ" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pickupPoints).toEqual([]);
    expect(result.current.data?.zboxes).toEqual([]);
    expect(result.current.data?.carriers).toEqual([]);
    expect(result.current.data?.freeShippingThreshold).toBeNull();
  });

  it("should include postal code in request", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: validResponse,
      error: null,
    });

    const { result } = renderHook(
      () =>
        useAvailableShippingMethods({
          country: "CZ",
          postalCode: "110 00",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.invokeMock).toHaveBeenCalledWith("packeta-api", {
      body: expect.objectContaining({
        postalCode: "110 00",
      }),
    });
  });

  it("should include GPS coordinates when provided", async () => {
    hoisted.invokeMock.mockResolvedValue({
      data: validResponse,
      error: null,
    });

    const { result } = renderHook(
      () =>
        useAvailableShippingMethods({
          country: "CZ",
          latitude: 50.08,
          longitude: 14.43,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(hoisted.invokeMock).toHaveBeenCalledWith("packeta-api", {
      body: expect.objectContaining({
        latitude: 50.08,
        longitude: 14.43,
      }),
    });
  });
});
