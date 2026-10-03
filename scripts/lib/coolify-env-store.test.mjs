/**
 * Unit tests for coolify-env-store pure helpers. Deterministic, no network.
 * Locks the two safety invariants the OIDC reconciler depends on:
 *   (1) never patch an empty value, (2) never add a key an app lacks.
 */
import { describe, expect, it } from "vitest";
import { envValue, hasKey, mergeEnvValue, productionValue } from "./coolify-env-store.mjs";

const envs = [
  { key: "A", value: "prod-a", is_preview: false, uuid: "u1" },
  { key: "A", value: "preview-a", is_preview: true, uuid: "u2" },
  { key: "B", value: "prod-b", is_preview: false, uuid: "u3" },
];

describe("envValue", () => {
  it("prefers the production (non-preview) entry", () => {
    expect(envValue(envs, "A")).toBe("prod-a");
  });
  it("returns '' for a missing key", () => {
    expect(envValue(envs, "ZZZ")).toBe("");
  });
  it("falls back to any entry when no production one exists", () => {
    expect(envValue([{ key: "C", value: "only", is_preview: true }], "C")).toBe("only");
  });
});

describe("productionValue — reconciler must not flap on preview-only keys", () => {
  it("returns the production value when present", () => {
    expect(productionValue(envs, "A")).toBe("prod-a");
  });
  it("returns null (NOT the preview value) for a preview-only key", () => {
    // Regression: envValue falls back to preview, but mergeEnvValue only patches
    // production entries — so drift detection had to stop counting preview-only
    // keys or --check would flap red forever ("healed" that never lands).
    const previewOnly = [{ key: "P", value: "pv", is_preview: true }];
    expect(envValue(previewOnly, "P")).toBe("pv"); // envValue still falls back
    expect(productionValue(previewOnly, "P")).toBeNull(); // reconciler skips it
  });
  it("returns null for a missing key", () => {
    expect(productionValue(envs, "ZZZ")).toBeNull();
  });
});

describe("hasKey", () => {
  it("true when present (any preview flavour), false otherwise", () => {
    expect(hasKey(envs, "A")).toBe(true);
    expect(hasKey(envs, "B")).toBe(true);
    expect(hasKey(envs, "ZZZ")).toBe(false);
  });
});

describe("mergeEnvValue — safety invariants", () => {
  it("updates only the production entry whose value differs", () => {
    const { merged, changed } = mergeEnvValue(envs, "A", "new-a");
    expect(changed).toBe(true);
    expect(merged.find((e) => e.key === "A" && e.is_preview === false).value).toBe("new-a");
    // preview entry untouched
    expect(merged.find((e) => e.key === "A" && e.is_preview === true).value).toBe("preview-a");
    // marks is_literal so Coolify stores a plain value
    expect(merged.find((e) => e.key === "A" && e.is_preview === false).is_literal).toBe(true);
  });

  it("refuses to write an empty value (invariant 1)", () => {
    for (const empty of ["", null, undefined]) {
      const { merged, changed } = mergeEnvValue(envs, "A", empty);
      expect(changed).toBe(false);
      expect(merged).toBe(envs); // untouched reference
    }
  });

  it("does NOT add a key the app lacks (invariant 2)", () => {
    const { merged, changed } = mergeEnvValue(envs, "MISSING", "whatever");
    expect(changed).toBe(false);
    expect(merged.some((e) => e.key === "MISSING")).toBe(false);
  });

  it("no-op when the value already matches", () => {
    const { changed } = mergeEnvValue(envs, "A", "prod-a");
    expect(changed).toBe(false);
  });
});
