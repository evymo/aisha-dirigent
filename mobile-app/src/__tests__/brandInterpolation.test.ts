/**
 * White-label brand interpolation: the same i18n catalog must render the
 * build's brand, driven only by version.json (app.displayName + brand.shortName).
 */

// Default mock (overridden per-describe via jest.doMock + isolateModules).
jest.mock("expo-constants", () => ({ expoConfig: { name: "App", extra: {} } }));

describe("brand interpolation", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("expo-constants");
  });

  function loadApplyBrand(name: string, short: string | undefined, assistant?: string) {
    let fn!: (v: string) => string;
    jest.isolateModules(() => {
      jest.doMock("expo-constants", () => ({
        expoConfig: {
          name,
          extra: {
            ...(short === undefined ? {} : { AISHA_BRAND_SHORT: short }),
            ...(assistant === undefined ? {} : { AISHA_ASSISTANT_NAME: assistant }),
          },
        },
      }));
      // require() is unavoidable here: isolateModules needs a fresh CJS load
      // after doMock; the root config flags it as no-require-imports.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fn = require("@/hooks/useTranslation").applyBrand;
    });
    return fn;
  }

  it("AISHA build renders the AISHA product + assistant name", () => {
    const applyBrand = loadApplyBrand("AISHA Dirigent", "AISHA", "AISHA");
    expect(applyBrand("{{brandFull}}")).toBe("AISHA Dirigent");
    expect(applyBrand("{{assistant}} Chat")).toBe("AISHA Chat");
    expect(applyBrand("{{assistant}} is thinking...")).toBe("AISHA is thinking...");
    expect(applyBrand("Your {{brand}} Address")).toBe("Your AISHA Address");
  });

  it("re-skinned build renders its brand + distinct assistant from the same catalog", () => {
    const applyBrand = loadApplyBrand("Tenant Brand", "Tenant", "Tenant Assistant");
    expect(applyBrand("{{brandFull}}")).toBe("Tenant Brand");
    expect(applyBrand("Your {{brand}} Address")).toBe("Your Tenant Address");        // product brand
    expect(applyBrand("{{assistant}} Chat")).toBe("Tenant Assistant Chat");          // assistant name
    expect(applyBrand("{{assistant}} is thinking...")).toBe("Tenant Assistant is thinking...");
    // No AISHA literal survives anywhere.
    expect(applyBrand("{{brandFull}} · {{brand}} Wallet · {{assistant}} Chat")).not.toMatch(/AISHA/i);
  });

  it("assistant falls back to the short brand when assistantName is unset", () => {
    const applyBrand = loadApplyBrand("Tenant Brand", "Tenant", undefined);
    expect(applyBrand("{{assistant}} Chat")).toBe("Tenant Chat");
  });

  it("falls back to the full name when no short token is set", () => {
    const applyBrand = loadApplyBrand("Acme", undefined);
    expect(applyBrand("{{brand}} Chat")).toBe("Acme Chat");
  });

  it("leaves strings without placeholders untouched", () => {
    const applyBrand = loadApplyBrand("Tenant Brand", "Tenant");
    expect(applyBrand("Settings")).toBe("Settings");
  });
});
