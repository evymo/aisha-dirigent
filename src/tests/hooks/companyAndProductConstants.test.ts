import { describe, it, expect } from "vitest";
import {
  PRODUCT_IDENTIFIERS,
  getProductIdentifier,
  getProductByInternalCode,
  getProductByGtin,
  encodeGs1String,
} from "@/lib/constants/productIdentifiers";
import {
  generateProtocolNumber,
  orderConfirmationSchema,
  productionProtocolSchema,
} from "@/lib/constants/manufacturingProtocol";
import {
  EKORTN,
  RTN_THERAPEUTICS,
  EVYMO,
  COMPANIES_BY_ROLE,
  ALL_COMPANIES,
  DPO_CONTACT,
  STUDY_INFO,
} from "@/lib/constants/companyData";

// ── Product Identifiers ──────────────────────────────
describe("productIdentifiers", () => {
  it("has 5 products registered", () => {
    expect(Object.keys(PRODUCT_IDENTIFIERS)).toHaveLength(5);
  });

  it("all products have valid GTIN-14 (14 digits)", () => {
    for (const [slug, pid] of Object.entries(PRODUCT_IDENTIFIERS)) {
      expect(pid.gtin).toMatch(/^\d{14}$/);
      expect(pid.slug).toBe(slug);
    }
  });

  it("all products have non-empty internal codes", () => {
    for (const pid of Object.values(PRODUCT_IDENTIFIERS)) {
      expect(pid.internalCode.length).toBeGreaterThan(0);
    }
  });

  it("getProductIdentifier looks up by slug", () => {
    expect(getProductIdentifier("retisin")?.internalCode).toBe("DEMO-01");
    expect(getProductIdentifier("floristen")?.internalCode).toBe("DEMO-02");
    expect(getProductIdentifier("nonexistent")).toBeUndefined();
  });

  it("getProductByInternalCode looks up by R&D code", () => {
    expect(getProductByInternalCode("DEMO-01")?.slug).toBe("retisin");
    expect(getProductByInternalCode("DEMO-03")?.slug).toBe("lyastin");
    expect(getProductByInternalCode("UNKNOWN")).toBeUndefined();
  });

  it("getProductByGtin looks up by GTIN", () => {
    expect(getProductByGtin("00000000000017")?.slug).toBe("retisin");
    expect(getProductByGtin("00000000000000")).toBeUndefined();
  });

  it("encodeGs1String produces correct format", () => {
    const gs1 = encodeGs1String({
      gtin: "00000000000017",
      batchLot: "DEMO-01-2026-001",
      productionDate: "260115",
      expiryDate: "270115",
    });

    expect(gs1).toBe(
      "(01)00000000000017(10)DEMO-01-2026-001(11)260115(17)270115"
    );
  });

  it("encodeGs1String includes optional serial number", () => {
    const gs1 = encodeGs1String({
      gtin: "00000000000017",
      batchLot: "B001",
      productionDate: "260101",
      expiryDate: "270101",
      serialNumber: "SN-0001",
    });

    expect(gs1).toContain("(21)SN-0001");
  });
});

// ── Manufacturing Protocol ───────────────────────────
describe("manufacturingProtocol", () => {
  it("generateProtocolNumber produces VP-YYYY-SHORTID format", () => {
    const pn = generateProtocolNumber(
      "a1b2c3d4-5678-9abc-def0-123456789012",
      new Date("2026-03-15")
    );
    expect(pn).toBe("VP-2026-A1B2C3D4");
  });

  it("generateProtocolNumber uses current year by default", () => {
    const pn = generateProtocolNumber("abc-123");
    const year = new Date().getFullYear();
    expect(pn).toBe(`VP-${year}-ABC`);
  });

  it("orderConfirmationSchema validates valid data", () => {
    const result = orderConfirmationSchema.safeParse({
      protocolNumber: "VP-2026-TEST",
      confirmationDate: new Date().toISOString(),
      memberId: "00000000-0000-0000-0000-000000000001",
      items: [
        {
          slug: "retisin",
          productName: "Demo Product 1 DEMO-01",
          internalCode: "DEMO-01",
          gtin: "00000000000017",
          quantity: 1,
          unitPriceCzk: 3800,
        },
      ],
      totalCzk: 3800,
      shippingMethod: "packeta_pickup",
      consentsAcknowledged: ["gdpr", "terms"],
    });
    expect(result.success).toBe(true);
  });

  it("orderConfirmationSchema rejects invalid memberId", () => {
    const result = orderConfirmationSchema.safeParse({
      protocolNumber: "VP-2026-TEST",
      confirmationDate: new Date().toISOString(),
      memberId: "not-a-uuid",
      items: [],
      totalCzk: 0,
      shippingMethod: "personal",
      consentsAcknowledged: [],
    });
    expect(result.success).toBe(false);
  });

  it("productionProtocolSchema validates valid data with gs1", () => {
    const result = productionProtocolSchema.safeParse({
      protocolNumber: "VP-2026-TEST",
      batchCode: "DEMO-01-2026-001",
      gs1Data: {
        gtin: "00000000000017",
        batchLot: "DEMO-01-2026-001",
        productionDate: "260115",
        expiryDate: "270115",
      },
    });
    expect(result.success).toBe(true);
  });

  it("productionProtocolSchema rejects invalid GTIN length", () => {
    const result = productionProtocolSchema.safeParse({
      protocolNumber: "VP-2026-TEST",
      gs1Data: {
        gtin: "123", // too short
        batchLot: "B001",
        productionDate: "260115",
        expiryDate: "270115",
      },
    });
    expect(result.success).toBe(false);
  });
});

// ── Company Data ─────────────────────────────────────
describe("companyData", () => {
  it("EKORTN has correct company ID and role", () => {
    expect(EKORTN.companyId).toBe("000 00 000");
    expect(EKORTN.role).toBe("website_operator");
    expect(EKORTN.taxId).toBe("CZ00000000");
  });

  it("RTN_THERAPEUTICS has correct company ID and role", () => {
    expect(RTN_THERAPEUTICS.companyId).toBe("000 00 000");
    expect(RTN_THERAPEUTICS.role).toBe("study_organizer");
  });

  it("EVYMO has correct company ID and role", () => {
    expect(EVYMO.companyId).toBe("000 00 000");
    expect(EVYMO.role).toBe("data_processor");
  });

  it("COMPANIES_BY_ROLE maps each role to correct entity", () => {
    expect(COMPANIES_BY_ROLE.website_operator).toBe(EKORTN);
    expect(COMPANIES_BY_ROLE.study_organizer).toBe(RTN_THERAPEUTICS);
    expect(COMPANIES_BY_ROLE.data_processor).toBe(EVYMO);
  });

  it("ALL_COMPANIES contains exactly 3 entities", () => {
    expect(ALL_COMPANIES).toHaveLength(3);
  });

  it("DPO_CONTACT has email and name", () => {
    expect(DPO_CONTACT.email).toBeDefined();
    expect(DPO_CONTACT.name).toBeDefined();
  });

  it("STUDY_INFO has both language variants", () => {
    expect(STUDY_INFO.nameCz.length).toBeGreaterThan(0);
    expect(STUDY_INFO.nameEn.length).toBeGreaterThan(0);
    expect(STUDY_INFO.organizer).toBe(RTN_THERAPEUTICS);
    expect(STUDY_INFO.distributor).toBe(EKORTN);
  });
});
