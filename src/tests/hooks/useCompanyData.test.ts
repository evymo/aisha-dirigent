import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "cs" },
  }),
}));

// ── Tests ────────────────────────────────────────────
describe("useCompanyData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns consentInterpolation with all required fields", async () => {
    const { useCompanyData } = await import("@/hooks/useCompanyData");
    const { result } = renderHook(() => useCompanyData());

    const ci = result.current.consentInterpolation;

    // All required interpolation fields must be present
    expect(ci.operatorName).toBe("Example Operator s.r.o.");
    expect(ci.operatorCompanyId).toBe("000 00 000");
    expect(ci.operatorTaxId).toBe("CZ00000000");
    expect(ci.operatorWebsite).toBe("www.example.com");
    expect(ci.organizerName).toBe("Example Organizer s.r.o.");
    expect(ci.organizerCompanyId).toBe("000 00 000");
    expect(ci.processorName).toBe("Example Processor s.r.o.");
    expect(ci.processorCompanyId).toBe("000 00 000");
    expect(ci.dpoName).toBeDefined();
    expect(ci.dpoEmail).toBeDefined();
  });

  it("returns Czech study name when language is cs", async () => {
    const { useCompanyData } = await import("@/hooks/useCompanyData");
    const { result } = renderHook(() => useCompanyData());

    expect(result.current.studyName).toBe(
      "Ukázková studie"
    );
    expect(result.current.consentInterpolation.studyName).toBe(
      result.current.studyName
    );
  });

  it("returns English study name when language is en", async () => {
    // Override i18n mock for this test
    vi.doMock("react-i18next", () => ({
      useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "en" },
      }),
    }));

    // Re-import after mock change
    vi.resetModules();
    const { useCompanyData } = await import("@/hooks/useCompanyData");
    const { result } = renderHook(() => useCompanyData());

    expect(result.current.studyName).toBe(
      "Example Study"
    );

    // Restore original mock
    vi.doMock("react-i18next", () => ({
      useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "cs" },
      }),
    }));
  });

  it("exposes operator, organizer, and processor entities", async () => {
    vi.resetModules();
    const { useCompanyData } = await import("@/hooks/useCompanyData");
    const { result } = renderHook(() => useCompanyData());

    expect(result.current.operator.role).toBe("website_operator");
    expect(result.current.organizer.role).toBe("study_organizer");
    expect(result.current.processor.role).toBe("data_processor");
  });

  it("consentInterpolation addresses are non-empty strings", async () => {
    vi.resetModules();
    const { useCompanyData } = await import("@/hooks/useCompanyData");
    const { result } = renderHook(() => useCompanyData());

    const ci = result.current.consentInterpolation;
    expect(ci.operatorAddress.length).toBeGreaterThan(0);
    expect(ci.organizerAddress.length).toBeGreaterThan(0);
    expect(ci.processorAddress.length).toBeGreaterThan(0);
    expect(ci.operatorCourt.length).toBeGreaterThan(0);
  });
});
