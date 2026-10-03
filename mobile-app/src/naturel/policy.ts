/**
 * Naturel F0 — DialogPolicy resolver (faithful TypeScript port).
 *
 * Source of truth: @aisha/extranet-sdk-ui (src/naturel.js)
 * (resolvePolicy, v0.1 2026-07-19) implementing ZAMEST/naturel-koncept.md v0.1
 * (Z5 subset). Pure and deterministic — replay-testable; the port fidelity is
 * pinned by src/__tests__/naturelPolicy.test.ts. In F1+ the platform's
 * naturel.policy(userId, storyId) replaces this and clients only consume.
 *
 * Binding rules carried over (koncept E1–E8): the profile is a communication
 * PREFERENCE, never a diagnosis; the app consumes only the DialogPolicy;
 * explicit user override (class A / S19) always wins; personalization never
 * changes facts, numbers, sources, flags or deadlines (E8).
 */

export interface NaturelAxis {
  /** Position on the axis, −1..+1. */
  v: number;
  /** Confidence 0..1 — below 0.3 the resolver treats the axis as neutral. */
  c: number;
}

export type AuthorityMode = "desk" | "ripen" | "consult" | "data";

export interface NaturelAxes {
  initiative?: NaturelAxis;
  choice?: NaturelAxis;
  grain?: NaturelAxis;
  closure?: NaturelAxis;
  register?: NaturelAxis;
  /** N3 is a mode, not a scalar. */
  authority?: { mode: AuthorityMode };
}

export interface NaturelPrefs {
  form?: "prose" | "table";
  cadence?: "live" | "digest";
}

export type ArchetypeKey = "kurator" | "dispecer" | "dokoncovac" | "metodik" | "ladic";

export interface NaturelProfile {
  axes?: NaturelAxes;
  prefs?: NaturelPrefs;
  archetype?: {
    primary?: ArchetypeKey;
    secondary?: ArchetypeKey;
    /** Always a percentage mix, never a box (koncept kap. 02). */
    mix?: Partial<Record<ArchetypeKey, number>>;
  };
  override?: { locked?: boolean };
  /** Where the profile came from — F0 only ever 'calibration-z6' | 'override'. */
  source?: string;
  updatedAt?: string;
}

export interface DialogPolicy {
  choice: {
    mode: "variants" | "recommendation" | "steps";
    count: number;
    preselect: boolean;
    tradeoffs: boolean;
    deferOption: boolean;
    inviteOthers: boolean;
  };
  question: { style: "closed" | "open" | "mixed"; perMessage: 1 };
  message: {
    length: "brief" | "standard" | "rich";
    structure: "prose" | "table";
    evidence: "inline" | "onDemand";
  };
  cadence: { mode: "live" | "digest"; digestAt: string; nudge: "none" | "gentle" | "direct" };
  register: "warm" | "operational" | "plain";
  progress: { show: "ring" | "phases" | "none" };
}

/**
 * F0 reference resolver (Z5 subset) — line-faithful port of the SDK function.
 * Low-confidence axes (c < 0.3) resolve to the safe neutral default.
 */
export function resolvePolicy(profile?: NaturelProfile | null): DialogPolicy {
  const ax = profile?.axes ?? {};
  const v = (k: keyof Omit<NaturelAxes, "authority">): number => {
    const a = ax[k];
    return a && (a.c ?? 0) >= 0.3 ? a.v : 0;
  };
  const n2 = v("choice");
  const n4 = v("grain");
  const n5 = v("closure");
  const n6 = v("register");
  const n1 = v("initiative");
  const mode = n2 <= -0.3 ? "variants" : n2 >= 0.3 ? "steps" : "recommendation";
  return {
    choice: {
      mode,
      count: mode === "variants" ? 3 : 1,
      preselect: mode === "steps",
      tradeoffs: mode === "variants",
      deferOption: ax.authority?.mode === "ripen",
      inviteOthers: ax.authority?.mode === "consult",
    },
    question: { style: n6 <= -0.3 ? "closed" : n6 >= 0.3 ? "open" : "mixed", perMessage: 1 },
    message: {
      length: n4 <= -0.3 ? "brief" : n4 >= 0.3 ? "rich" : "standard",
      structure: profile?.prefs?.form === "table" ? "table" : n4 >= 0.3 ? "table" : "prose",
      evidence: ax.authority?.mode === "data" || n4 >= 0.3 ? "inline" : "onDemand",
    },
    cadence: {
      mode: profile?.prefs?.cadence === "digest" ? "digest" : n1 <= -0.3 ? "digest" : "live",
      digestAt: "08:00",
      nudge: ax.authority?.mode === "ripen" ? "none" : "gentle",
    },
    register: n6 >= 0.3 ? "warm" : n6 <= -0.3 ? "operational" : "plain",
    progress: { show: mode === "steps" ? "ring" : n5 >= 0.3 ? "phases" : "none" },
  };
}

/**
 * Mobile presentation bias — koncept kap. 07: „mobil = kratší podání téhož".
 * Shortens the FORM one notch; never touches evidence, flags or deadlines (E8)
 * and never changes what is said — only how much of it is expanded up front.
 */
export function mobileBias(policy: DialogPolicy): DialogPolicy {
  const length = policy.message.length === "rich" ? "standard" : "brief";
  return { ...policy, message: { ...policy.message, length } };
}

/**
 * Policy → falsifiable statement KEYS (Barnum-proof, test 04): each entry is an
 * i18n key + params describing what Aisha WILL DO — never what the user "is".
 * Screens translate via useTranslation (the SDK's Czech strings moved to i18n;
 * hardcoded locale literals are banned platform-wide).
 */
export interface PolicyWord {
  key: string;
  params?: Record<string, string | number>;
}

export function policyToWordKeys(p: DialogPolicy): PolicyWord[] {
  const out: PolicyWord[] = [];
  out.push(
    p.choice.mode === "variants"
      ? { key: "naturel.words.choiceVariants", params: { count: p.choice.count } }
      : p.choice.mode === "steps"
        ? { key: "naturel.words.choiceSteps" }
        : { key: "naturel.words.choiceRecommendation" },
  );
  out.push({
    key:
      p.message.length === "brief"
        ? "naturel.words.messageBrief"
        : p.message.length === "rich"
          ? "naturel.words.messageRich"
          : "naturel.words.messageStandard",
  });
  out.push({
    key: p.message.evidence === "inline" ? "naturel.words.evidenceInline" : "naturel.words.evidenceOnDemand",
  });
  out.push(
    p.cadence.mode === "digest"
      ? { key: "naturel.words.cadenceDigest", params: { at: p.cadence.digestAt } }
      : { key: "naturel.words.cadenceLive" },
  );
  if (p.choice.deferOption) out.push({ key: "naturel.words.deferOption" });
  if (p.choice.inviteOthers) out.push({ key: "naturel.words.inviteOthers" });
  return out;
}
