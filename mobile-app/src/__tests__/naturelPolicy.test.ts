/**
 * Port-fidelity tests for the F0 resolver — cases mirror the SDK reference
 * (_extranet-sdk .../src/naturel.js resolvePolicy). If these drift, the mobile
 * app and the web shells would speak to the same person differently.
 */
import { mobileBias, policyToWordKeys, resolvePolicy } from "@/naturel/policy";
import type { NaturelProfile } from "@/naturel/policy";

describe("resolvePolicy (F0 reference port)", () => {
  it("no profile → safe defaults (recommendation, standard, live, plain)", () => {
    const p = resolvePolicy(undefined);
    expect(p.choice.mode).toBe("recommendation");
    expect(p.choice.count).toBe(1);
    expect(p.message.length).toBe("standard");
    expect(p.message.structure).toBe("prose");
    expect(p.message.evidence).toBe("onDemand");
    expect(p.cadence.mode).toBe("live");
    expect(p.register).toBe("plain");
    expect(p.progress.show).toBe("none");
  });

  it("low confidence (< 0.3) neutralizes the axis — kurátor with c=0.2 stays recommendation", () => {
    const profile: NaturelProfile = { axes: { choice: { v: -0.8, c: 0.2 } } };
    expect(resolvePolicy(profile).choice.mode).toBe("recommendation");
  });

  it("kurátor (choice ≤ −0.3) → 3 variants with trade-offs, no preselect", () => {
    const p = resolvePolicy({ axes: { choice: { v: -0.6, c: 0.6 } } });
    expect(p.choice).toMatchObject({ mode: "variants", count: 3, tradeoffs: true, preselect: false });
  });

  it("dokončovač (choice ≥ 0.3) → steps, preselected, ring progress", () => {
    const p = resolvePolicy({ axes: { choice: { v: 0.7, c: 0.6 } } });
    expect(p.choice).toMatchObject({ mode: "steps", count: 1, preselect: true });
    expect(p.progress.show).toBe("ring");
  });

  it("authority modes map to defer/invite/nudge/evidence", () => {
    const ripen = resolvePolicy({ axes: { authority: { mode: "ripen" } } });
    expect(ripen.choice.deferOption).toBe(true);
    expect(ripen.cadence.nudge).toBe("none");

    const consult = resolvePolicy({ axes: { authority: { mode: "consult" } } });
    expect(consult.choice.inviteOthers).toBe(true);

    const data = resolvePolicy({ axes: { authority: { mode: "data" } } });
    expect(data.message.evidence).toBe("inline");
  });

  it("grain drives length/structure/evidence; table pref wins structure", () => {
    const detail = resolvePolicy({ axes: { grain: { v: 0.6, c: 0.6 } } });
    expect(detail.message).toMatchObject({ length: "rich", structure: "table", evidence: "inline" });

    const brief = resolvePolicy({ axes: { grain: { v: -0.5, c: 0.6 } }, prefs: { form: "table" } });
    expect(brief.message).toMatchObject({ length: "brief", structure: "table" });
  });

  it("cadence: digest pref wins; low initiative also digests", () => {
    expect(resolvePolicy({ prefs: { cadence: "digest" } }).cadence.mode).toBe("digest");
    expect(resolvePolicy({ axes: { initiative: { v: -0.4, c: 0.6 } } }).cadence.mode).toBe("digest");
    expect(resolvePolicy({}).cadence.digestAt).toBe("08:00");
  });

  it("register axis → warm/operational/plain", () => {
    expect(resolvePolicy({ axes: { register: { v: 0.5, c: 0.6 } } }).register).toBe("warm");
    expect(resolvePolicy({ axes: { register: { v: -0.5, c: 0.6 } } }).register).toBe("operational");
  });
});

describe("mobileBias (mobil = kratší podání téhož)", () => {
  it("shortens form one notch and touches nothing else", () => {
    const rich = resolvePolicy({ axes: { grain: { v: 0.6, c: 0.6 } } });
    const biased = mobileBias(rich);
    expect(biased.message.length).toBe("standard");
    // E8: evidence, structure and everything factual stay untouched
    expect(biased.message.evidence).toBe(rich.message.evidence);
    expect(biased.message.structure).toBe(rich.message.structure);
    expect(biased.choice).toEqual(rich.choice);
    expect(biased.cadence).toEqual(rich.cadence);

    expect(mobileBias(resolvePolicy(undefined)).message.length).toBe("brief");
  });
});

describe("policyToWordKeys (Barnum-proof statements)", () => {
  it("emits choice+message+evidence+cadence always, defer/invite conditionally", () => {
    const base = policyToWordKeys(resolvePolicy(undefined));
    expect(base.map((w) => w.key)).toEqual([
      "naturel.words.choiceRecommendation",
      "naturel.words.messageStandard",
      "naturel.words.evidenceOnDemand",
      "naturel.words.cadenceLive",
    ]);

    const ripen = policyToWordKeys(resolvePolicy({ axes: { authority: { mode: "ripen" } } }));
    expect(ripen.map((w) => w.key)).toContain("naturel.words.deferOption");

    const variants = policyToWordKeys(resolvePolicy({ axes: { choice: { v: -0.6, c: 0.6 } } }));
    expect(variants[0]).toEqual({ key: "naturel.words.choiceVariants", params: { count: 3 } });
  });
});
