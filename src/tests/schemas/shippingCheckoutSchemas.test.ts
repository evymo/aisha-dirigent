import { describe, expect, it } from "vitest";
import {
  shippingMethodSchema,
  shippingCategorySchema,
  shippingPointSchema,
  shippingCarrierSchema,
  availableMethodsResponseSchema,
  shippingSelectionSchema,
  getShippingCategory,
  isFreeShipping,
  freeShippingRemaining,
  type ShippingMethod,
  type ShippingCategory,
} from "@/lib/schemas/shippingCheckoutSchemas";

// ── shippingMethodSchema ───────────────────────────────────────

describe("shippingMethodSchema", () => {
  const validMethods: ShippingMethod[] = [
    "carrier_home",
    "carrier_pickup",
    "packeta_home",
    "packeta_pickup",
    "packeta_zbox",
    "personal_pickup",
  ];

  it.each(validMethods)("accepts valid method: %s", (method) => {
    expect(shippingMethodSchema.parse(method)).toBe(method);
  });

  it("rejects invalid method", () => {
    expect(shippingMethodSchema.safeParse("invalid").success).toBe(false);
    expect(shippingMethodSchema.safeParse("").success).toBe(false);
    expect(shippingMethodSchema.safeParse(null).success).toBe(false);
  });
});

// ── shippingCategorySchema ─────────────────────────────────────

describe("shippingCategorySchema", () => {
  const validCategories: ShippingCategory[] = [
    "pickup",
    "zbox",
    "home_delivery",
    "personal",
  ];

  it.each(validCategories)("accepts valid category: %s", (cat) => {
    expect(shippingCategorySchema.parse(cat)).toBe(cat);
  });

  it("rejects invalid category", () => {
    expect(shippingCategorySchema.safeParse("delivery").success).toBe(false);
  });
});

// ── shippingPointSchema ────────────────────────────────────────

describe("shippingPointSchema", () => {
  const validPoint = {
    city: "Praha",
    country: "CZ",
    creditCardPayment: false,
    id: 1001,
    latitude: 50.08,
    longitude: 14.43,
    maxWeight: 10,
    name: "Praha 1",
    photos: [],
    street: "Vodičkova 30",
    type: "branch" as const,
    wheelchairAccessible: true,
    zip: "11000",
  };

  it("accepts a valid branch point", () => {
    const result = shippingPointSchema.safeParse(validPoint);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(1001);
      expect(result.data.type).toBe("branch");
    }
  });

  it("accepts a valid zbox point", () => {
    const result = shippingPointSchema.safeParse({
      ...validPoint,
      type: "zbox",
      hasKeypad: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = shippingPointSchema.safeParse({
      ...validPoint,
      codAllowed: true,
      distance: 1.5,
      openingHours: "Po-Pá 8-20",
      photos: [{ normal: "https://a.com/1.jpg", thumbnail: "https://a.com/1t.jpg" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { city, ...noCity } = validPoint;
    expect(shippingPointSchema.safeParse(noCity).success).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(
      shippingPointSchema.safeParse({ ...validPoint, type: "warehouse" }).success,
    ).toBe(false);
  });
});

// ── shippingCarrierSchema ──────────────────────────────────────

describe("shippingCarrierSchema", () => {
  const validCarrier = {
    country: "CZ",
    deliveryType: "HD" as const,
    disallowsCod: false,
    displayName: "Zásilkovna domů",
    id: 106,
    maxWeight: 10,
    name: "CZ Zásilkovna domů HD",
    requiresEmail: false,
    requiresPhone: true,
  };

  it("accepts a valid carrier", () => {
    const result = shippingCarrierSchema.safeParse(validCarrier);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(106);
      expect(result.data.deliveryType).toBe("HD");
    }
  });

  it.each(["Box", "HD", "PP"] as const)(
    "accepts deliveryType: %s",
    (dt) => {
      expect(
        shippingCarrierSchema.safeParse({ ...validCarrier, deliveryType: dt }).success,
      ).toBe(true);
    },
  );

  it("rejects invalid deliveryType", () => {
    expect(
      shippingCarrierSchema.safeParse({ ...validCarrier, deliveryType: "EX" }).success,
    ).toBe(false);
  });
});

// ── availableMethodsResponseSchema ─────────────────────────────

describe("availableMethodsResponseSchema", () => {
  const validResponse = {
    carrierPickupPoints: [],
    carriers: [],
    costs: { packeta_pickup: 79, packeta_home: 99 },
    freeShippingThreshold: 1500,
    personalPickupAvailable: true,
    pickupPoints: [],
    totalBranchCount: 500,
    totalZboxCount: 200,
    zboxes: [],
  };

  it("accepts a valid response", () => {
    const result = availableMethodsResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it("accepts null freeShippingThreshold", () => {
    const result = availableMethodsResponseSchema.safeParse({
      ...validResponse,
      freeShippingThreshold: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { costs, ...noCosts } = validResponse;
    expect(availableMethodsResponseSchema.safeParse(noCosts).success).toBe(false);
  });
});

// ── shippingSelectionSchema ────────────────────────────────────

describe("shippingSelectionSchema", () => {
  it("accepts a full selection", () => {
    const result = shippingSelectionSchema.safeParse({
      carrierId: 106,
      carrierName: "DPD",
      method: "carrier_home",
      packetaBranchId: null,
      selectedPoint: null,
      shippingCost: 99,
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults", () => {
    const result = shippingSelectionSchema.safeParse({
      method: "personal_pickup",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.carrierId).toBeNull();
      expect(result.data.shippingCost).toBe(0);
      expect(result.data.selectedPoint).toBeNull();
    }
  });

  it("rejects invalid method", () => {
    expect(
      shippingSelectionSchema.safeParse({ method: "invalid" }).success,
    ).toBe(false);
  });
});

// ── getShippingCategory helper ─────────────────────────────────

describe("getShippingCategory", () => {
  it.each<[ShippingMethod, ShippingCategory]>([
    ["packeta_pickup", "pickup"],
    ["carrier_pickup", "pickup"],
    ["packeta_zbox", "zbox"],
    ["packeta_home", "home_delivery"],
    ["carrier_home", "home_delivery"],
    ["personal_pickup", "personal"],
  ])("maps %s to %s", (method, expected) => {
    expect(getShippingCategory(method)).toBe(expected);
  });
});

// ── isFreeShipping helper ──────────────────────────────────────

describe("isFreeShipping", () => {
  it("returns true when subtotal >= threshold", () => {
    expect(isFreeShipping(1500, 1500)).toBe(true);
    expect(isFreeShipping(2000, 1500)).toBe(true);
  });

  it("returns false when subtotal < threshold", () => {
    expect(isFreeShipping(1499, 1500)).toBe(false);
  });

  it("returns false when threshold is null", () => {
    expect(isFreeShipping(99999, null)).toBe(false);
  });
});

// ── freeShippingRemaining helper ───────────────────────────────

describe("freeShippingRemaining", () => {
  it("returns remaining amount below threshold", () => {
    expect(freeShippingRemaining(1200, 1500)).toBe(300);
  });

  it("returns 0 when at or above threshold", () => {
    expect(freeShippingRemaining(1500, 1500)).toBe(0);
    expect(freeShippingRemaining(2000, 1500)).toBe(0);
  });

  it("returns Infinity when threshold is null", () => {
    expect(freeShippingRemaining(500, null)).toBe(Infinity);
  });
});
