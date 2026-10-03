/**
 * Z6 calibration fold tests — answers → F0 profile (SDK _calibration port).
 */
import { CALIBRATION_STEPS, calibrationToProfile } from "@/naturel/calibration";
import { resolvePolicy } from "@/naturel/policy";

describe("calibrationToProfile", () => {
  it("kurátor + detail + brief → variants profile with metodik in the mix", () => {
    // podání: varianty (kurator) · forma: detail (metodik) · kadence: brief (ladic)
    const { profile } = calibrationToProfile([0, 1, 1]);

    expect(profile.axes?.choice).toEqual({ v: -0.6, c: 0.6 });
    expect(profile.axes?.grain).toEqual({ v: 0.6, c: 0.6 });
    expect(profile.prefs).toMatchObject({ form: "prose", cadence: "digest" });
    expect(profile.source).toBe("calibration-z6");

    // Mix is normalized percentages over answered steps — never a single box
    expect(profile.archetype?.mix).toEqual({ kurator: 1 / 3, metodik: 1 / 3, ladic: 1 / 3 });
    expect(profile.archetype?.primary).toBeDefined();

    const policy = resolvePolicy(profile);
    expect(policy.choice.mode).toBe("variants");
    expect(policy.cadence.mode).toBe("digest");
  });

  it("dokončovač path folds cumulative axis patches with clamp", () => {
    const { profile } = calibrationToProfile([2, 2, 0]);
    expect(profile.axes?.choice).toEqual({ v: 0.7, c: 0.6 });
    expect(profile.axes?.closure).toEqual({ v: 0.2, c: 0.6 });
    expect(profile.prefs).toMatchObject({ form: "table", cadence: "live" });
    expect(resolvePolicy(profile).choice.mode).toBe("steps");
    expect(resolvePolicy(profile).message.structure).toBe("table");
  });

  it("unanswered steps contribute nothing; empty answers → empty profile", () => {
    const { profile } = calibrationToProfile([]);
    expect(profile.axes).toEqual({});
    expect(profile.archetype).toBeUndefined();
    // Safe default policy still resolves
    expect(resolvePolicy(profile).choice.mode).toBe("recommendation");
  });

  it("step data stays consistent with the SDK: 3/3/2 options", () => {
    expect(CALIBRATION_STEPS.map((s) => s.options.length)).toEqual([3, 3, 2]);
  });
});
