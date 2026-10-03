/**
 * Naturel F0 — Z6 calibration data + answer→patch fold (port of the SDK's
 * STEPS + _calibration from _extranet-sdk .../src/naturel.js, strings → i18n).
 *
 * Three choices posed as WORK, not a questionnaire (koncept Z6): podání /
 * forma / kadence. Skipping is legitimate — safe defaults + nothing persisted.
 * Answers fold into an axes patch at confidence 0.6 (calibration is a start,
 * behaviour keeps tuning later — in F1+, not in this build).
 */
import type { ArchetypeKey, NaturelAxes, NaturelPrefs, NaturelProfile } from "./policy";
import { resolvePolicy } from "./policy";

export interface CalibrationOption {
  /** i18n keys — naturel.steps.<step>.opt<i>.title / .detail */
  titleKey: string;
  detailKey: string;
  patch?: Partial<Record<"initiative" | "choice" | "grain" | "closure" | "register", number>>;
  pref?: NaturelPrefs;
  arch?: ArchetypeKey;
}

export interface CalibrationStep {
  key: "podani" | "forma" | "kadence";
  overlineKey: string;
  questionKey: string;
  options: CalibrationOption[];
}

/** Mirror of SDK STEPS — keys instead of literals, values identical. */
export const CALIBRATION_STEPS: CalibrationStep[] = [
  {
    key: "podani",
    overlineKey: "naturel.steps.podani.overline",
    questionKey: "naturel.steps.podani.question",
    options: [
      { titleKey: "naturel.steps.podani.opt0.title", detailKey: "naturel.steps.podani.opt0.detail", patch: { choice: -0.6 }, arch: "kurator" },
      { titleKey: "naturel.steps.podani.opt1.title", detailKey: "naturel.steps.podani.opt1.detail", patch: { choice: 0.1 }, arch: "dispecer" },
      { titleKey: "naturel.steps.podani.opt2.title", detailKey: "naturel.steps.podani.opt2.detail", patch: { choice: 0.7, closure: 0.2 }, arch: "dokoncovac" },
    ],
  },
  {
    key: "forma",
    overlineKey: "naturel.steps.forma.overline",
    questionKey: "naturel.steps.forma.question",
    options: [
      { titleKey: "naturel.steps.forma.opt0.title", detailKey: "naturel.steps.forma.opt0.detail", patch: { grain: -0.5 }, pref: { form: "prose" } },
      { titleKey: "naturel.steps.forma.opt1.title", detailKey: "naturel.steps.forma.opt1.detail", patch: { grain: 0.6 }, pref: { form: "prose" }, arch: "metodik" },
      { titleKey: "naturel.steps.forma.opt2.title", detailKey: "naturel.steps.forma.opt2.detail", patch: { grain: 0.3 }, pref: { form: "table" } },
    ],
  },
  {
    key: "kadence",
    overlineKey: "naturel.steps.kadence.overline",
    questionKey: "naturel.steps.kadence.question",
    options: [
      { titleKey: "naturel.steps.kadence.opt0.title", detailKey: "naturel.steps.kadence.opt0.detail", patch: {}, pref: { cadence: "live" } },
      { titleKey: "naturel.steps.kadence.opt1.title", detailKey: "naturel.steps.kadence.opt1.detail", patch: { initiative: -0.2 }, pref: { cadence: "digest" }, arch: "ladic" },
    ],
  },
];

const clamp = (x: number) => Math.max(-1, Math.min(1, x));

export interface CalibrationResult {
  profile: NaturelProfile;
}

/**
 * Fold selected option indexes (per step) into an F0 profile — the SDK's
 * _calibration() with the archetype hint normalized into the mandatory
 * percentage MIX (never a box): counts / answered.
 */
export function calibrationToProfile(answers: Array<number | undefined>): CalibrationResult {
  const axes: NaturelAxes = {};
  const prefs: NaturelPrefs = {};
  const archCounts: Partial<Record<ArchetypeKey, number>> = {};
  let answered = 0;

  answers.forEach((optIndex, stepIndex) => {
    const opt = optIndex === undefined ? undefined : CALIBRATION_STEPS[stepIndex]?.options[optIndex];
    if (!opt) return;
    answered += 1;
    Object.entries(opt.patch ?? {}).forEach(([axis, delta]) => {
      const k = axis as "initiative" | "choice" | "grain" | "closure" | "register";
      const prev = axes[k]?.v ?? 0;
      axes[k] = { v: clamp(prev + (delta as number)), c: 0.6 };
    });
    Object.assign(prefs, opt.pref ?? {});
    if (opt.arch) archCounts[opt.arch] = (archCounts[opt.arch] ?? 0) + 1;
  });

  const mixEntries = Object.entries(archCounts) as Array<[ArchetypeKey, number]>;
  const mix: Partial<Record<ArchetypeKey, number>> = {};
  mixEntries.forEach(([k, n]) => {
    mix[k] = n / Math.max(1, answered);
  });
  const sorted = mixEntries.sort((a, b) => b[1] - a[1]);

  const profile: NaturelProfile = {
    axes,
    prefs,
    ...(sorted.length
      ? { archetype: { primary: sorted[0]![0], ...(sorted[1] ? { secondary: sorted[1][0] } : {}), mix } }
      : {}),
    source: "calibration-z6",
  };
  return { profile };
}

/** Convenience for the summary screen: what the calibrated profile resolves to. */
export function calibrationPolicy(answers: Array<number | undefined>) {
  return resolvePolicy(calibrationToProfile(answers).profile);
}
