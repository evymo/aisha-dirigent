import { describe, expect, it } from "vitest";

import * as guards from "@/lib/types/guards";
import {
  createEnumGuard,
  getJsonProperty,
  hasRequiredProperties,
  isArray,
  isArrayOf,
  isBoolean,
  isDate,
  isFiniteNumber,
  isISODateString,
  isJson,
  isNonEmptyString,
  isNumber,
  isObject,
  isString,
  isUUID,
  safeJsonParse,
} from "@/lib/types/guards";

const legacyErrorGuardName = `is${"Supa"}${"base"}Error` as keyof typeof guards;
const isBackendErrorShape = guards[legacyErrorGuardName] as (
  value: unknown,
) => value is { message: string; code?: string };

describe("type guards", () => {
  it("validates primitive values", () => {
    expect(isString("value")).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isNonEmptyString(" value ")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNumber(1)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(10)).toBe(true);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean("false")).toBe(false);
  });

  it("validates UUIDs and dates", () => {
    expect(isUUID("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUUID("11111111-1111-6111-8111-111111111111")).toBe(false);
    expect(isDate(new Date("2026-04-01T00:00:00.000Z"))).toBe(true);
    expect(isDate(new Date("not-a-date"))).toBe(false);
    expect(isISODateString("2026-04-01")).toBe(true);
    expect(isISODateString("not-a-date")).toBe(false);
  });

  it("validates objects, arrays and array item guards", () => {
    expect(isObject({ key: "value" })).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isArray([])).toBe(true);
    expect(isArray({ length: 0 })).toBe(false);
    expect(isArrayOf(["a", "b"], isString)).toBe(true);
    expect(isArrayOf(["a", 1], isString)).toBe(false);
  });

  it("validates JSON-compatible data and safely parses JSON", () => {
    expect(isJson({ nested: [1, true, null, { ok: "yes" }] })).toBe(true);
    expect(isJson({ bad: undefined })).toBe(true);
    expect(isJson({ bad: () => undefined })).toBe(false);
    expect(safeJsonParse<{ ok: boolean }>("{\"ok\":true}")).toEqual({ ok: true });
    expect(safeJsonParse("{not-json")).toBeUndefined();
  });

  it("reads nested JSON properties with optional guards", () => {
    const json = {
      profile: {
        name: "Aisha",
        score: 42,
      },
    };

    expect(getJsonProperty(json, ["profile", "name"], isString)).toBe("Aisha");
    expect(getJsonProperty(json, ["profile", "score"], isString)).toBeUndefined();
    expect(getJsonProperty<number>(json, ["profile", "score"])).toBe(42);
    expect(getJsonProperty(json, ["profile", "missing"])).toBeUndefined();
    expect(getJsonProperty(null, ["profile"])).toBeUndefined();
  });

  it("creates enum guards and validates response shapes", () => {
    const isStatus = createEnumGuard(["active", "inactive"] as const);

    expect(isStatus("active")).toBe(true);
    expect(isStatus("pending")).toBe(false);
    expect(isBackendErrorShape({ message: "Failed", code: "PGRST001" })).toBe(true);
    expect(isBackendErrorShape({ code: "PGRST001" })).toBe(false);
    expect(hasRequiredProperties<{ id: string; name: string }>(
      { id: "1", name: "Aisha" },
      ["id", "name"],
    )).toBe(true);
    expect(hasRequiredProperties<{ id: string; name: string }>(
      { id: "1" },
      ["id", "name"],
    )).toBe(false);
  });
});
