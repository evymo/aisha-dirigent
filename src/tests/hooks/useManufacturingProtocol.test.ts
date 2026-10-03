import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ── Tests ────────────────────────────────────────────
describe("useManufacturingProtocol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildProductionProtocol returns validated protocol for known product", async () => {
    const { useManufacturingProtocol } = await import(
      "@/hooks/useManufacturingProtocol"
    );
    const { result } = renderHook(() => useManufacturingProtocol());

    const protocol = result.current.buildProductionProtocol({
      protocolNumber: "VP-2026-A1B2C3D4",
      productSlug: "retisin",
      batchLot: "DEMO-01-2026-001",
      productionDate: "260115",
      expiryDate: "270115",
      serialNumber: "SN-0001",
      batchCode: "DEMO-01-2026-001",
    });

    expect(protocol).not.toBeNull();
    expect(protocol?.protocolNumber).toBe("VP-2026-A1B2C3D4");
    expect(protocol?.gs1Data?.gtin).toBe("00000000000017");
    expect(protocol?.gs1Data?.batchLot).toBe("DEMO-01-2026-001");
    expect(protocol?.gs1Data?.serialNumber).toBe("SN-0001");
    expect(protocol?.batchCode).toBe("DEMO-01-2026-001");
  });

  it("buildProductionProtocol returns protocol without gs1Data for unknown product", async () => {
    const { useManufacturingProtocol } = await import(
      "@/hooks/useManufacturingProtocol"
    );
    const { result } = renderHook(() => useManufacturingProtocol());

    const protocol = result.current.buildProductionProtocol({
      protocolNumber: "VP-2026-XXXXXX",
      productSlug: "nonexistent",
      batchLot: "NE-001",
      productionDate: "260115",
      expiryDate: "270115",
    });

    expect(protocol).not.toBeNull();
    expect(protocol?.gs1Data).toBeUndefined();
  });

  it("buildProductionProtocol includes quality control data when provided", async () => {
    const { useManufacturingProtocol } = await import(
      "@/hooks/useManufacturingProtocol"
    );
    const { result } = renderHook(() => useManufacturingProtocol());

    const protocol = result.current.buildProductionProtocol(
      {
        protocolNumber: "VP-2026-TEST",
        productSlug: "retisin",
        batchLot: "DEMO-01-2026-002",
        productionDate: "260201",
        expiryDate: "270201",
      },
      {
        approved: true,
        inspector: "QC-001",
        notes: "All clear",
      }
    );

    expect(protocol?.qualityControl?.approved).toBe(true);
    expect(protocol?.qualityControl?.inspector).toBe("QC-001");
    expect(protocol?.qualityControl?.approvedAt).toBeDefined();
  });

  it("encodeBarcode produces a GS1-128 string", async () => {
    const { useManufacturingProtocol } = await import(
      "@/hooks/useManufacturingProtocol"
    );
    const { result } = renderHook(() => useManufacturingProtocol());

    const gs1 = result.current.encodeBarcode({
      gtin: "00000000000017",
      batchLot: "DEMO-01-2026-001",
      productionDate: "260115",
      expiryDate: "270115",
    });

    expect(gs1).toContain("(01)00000000000017");
    expect(gs1).toContain("(10)DEMO-01-2026-001");
    expect(gs1).toContain("(11)260115");
    expect(gs1).toContain("(17)270115");
  });

  it("encodeBarcode includes serial number when provided", async () => {
    const { useManufacturingProtocol } = await import(
      "@/hooks/useManufacturingProtocol"
    );
    const { result } = renderHook(() => useManufacturingProtocol());

    const gs1 = result.current.encodeBarcode({
      gtin: "00000000000017",
      batchLot: "B001",
      productionDate: "260115",
      expiryDate: "270115",
      serialNumber: "SN-0001",
    });

    expect(gs1).toContain("(21)SN-0001");
  });

  it("getIdentifier returns product identifier by slug", async () => {
    const { useManufacturingProtocol } = await import(
      "@/hooks/useManufacturingProtocol"
    );
    const { result } = renderHook(() => useManufacturingProtocol());

    const retisin = result.current.getIdentifier("retisin");
    expect(retisin?.internalCode).toBe("DEMO-01");
    expect(retisin?.gtin).toBe("00000000000017");
    expect(retisin?.commercialName).toContain("Demo Product 1");

    const unknown = result.current.getIdentifier("nonexistent");
    expect(unknown).toBeUndefined();
  });
});
