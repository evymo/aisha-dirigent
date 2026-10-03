# Dosing as Distribution Cadence — the concept behind `dose_*`

> **Key insight (from user feedback):**
> The word **"dose / dosage" is misleading.** It reads as "medication amount", but
> the real concept is general: a **planned, recurring moment of focus** — a beat of
> an activity that someone commits to over time, with their own choices and notes,
> and which is only visible to those who are *trusted* to see it.
>
> The platform already names the general thing: **distribution**
> (`distribution_protocols`, `member_distribution_plans`, `distribution_adjustments`).
> **"Dose" is just the magnitude of one beat inside a distribution.** Dosing is one
> *instance* of the model (a medical/supplement regimen); the same shape fits any
> recurring planned commitment — a training plan, a practice cadence, an activity
> reminder. **No new concept, no new tables** — this doc only puts the existing
> primitives into words.

This is the same move as the [Universal Member Model](../audience/UNIVERSAL_MEMBER_MODEL.md):
source-specific names are manifestations of one existing model, surfaced as a lens.

---

## 1. The model in one picture

```
   RECOMMENDED ENVELOPE      PRESCRIBED PLAN          MEMBER REALIZATION         REALIZED BEATS
   (soft bounds of a beat)   (the cadence a study     (the member's own          (what actually
                              /program prescribes)     chosen cadence + notes)    happened)
   ┌────────────────────┐    ┌───────────────────┐    ┌────────────────────┐     ┌─────────────┐
   │ product_dose_units │──► │ study_distribution│──► │ member_distribution│ ──► │ dosing_logs │
   │ min/max/default/   │    │ _protocols        │    │ _plans             │     │ (free-form, │
   │ step  (advisory)   │    │ dose_amount,      │    │ + custom_dose,     │     │  real-world)│
   │                    │    │ doses_per_day,    │    │   custom_notes     │     │             │
   │  ANON / catalog    │    │ timing, arm       │    │  MEMBER-OWN        │     │  MEMBER-OWN │
   └────────────────────┘    └───────────────────┘    └─────────┬──────────┘     └─────────────┘
                                                                 │  ▲
                                          TRUST-SCOPED RE-TUNING │  │ consent + role + audit
                                          ┌────────────────────┐ │  │
                                          │ distribution_      │◄┘  │
                                          │ adjustments        │────┘
                                          │ (consultant: new   │
                                          │  dose, reason,     │   CONSULTANT/ADMIN
                                          │  authorized_by)    │   + data-sharing consent
                                          └────────────────────┘   + audit journal
```

A member is enrolled in a **study** — but "study" here means **trust**: an
involvement that grants *who may see and re-tune* the member's cadence. As the
member realizes beats against the prescribed plan, the gap feeds **evaluation
jumps** (compliance, streaks, escalation) keyed to that involvement.

## 2. The vocabulary map (technical name → concept → who)

| Technical (medical surface) | Concept (general) | Who may touch it |
|---|---|---|
| `product_dose_units` (min/max/default/step) | **Recommended envelope** — the soft bounds of one beat; *recommendations, not enforcement* | public / anon (catalog config) |
| `study_distribution_protocols` (dose_amount, doses_per_day, dose_timing, arm) | **Prescribed plan** — the cadence a study/program prescribes for a product, per arm | study-scoped |
| `member_distribution_plans` (+ `custom_dose_amount`, `custom_instructions`) | **Member realization** — the member's own chosen cadence, with their overrides and notes | member-own + trusted consultant |
| `distribution_adjustments` (`new_dose_amount`, `reason`, `authorized_by`) | **Trust-scoped re-tuning** — a consultant adjusting the beat under consent | consultant/admin + consent + **audit** |
| `dosing_logs` | **Realized beats** — what actually happened (free-form, so real-world out-of-bounds data is kept) | member-own + consented consultant |
| `validate_dose_proposal(...)` | **Advisory check at the moment of focus** — see §3 | anon (envelope) / consultant+consent (member) |

> **Why nothing ever blocks:** the platform collects *real-world* data. Envelopes
> and plans are advisory; a member may legitimately log an out-of-range beat. The
> access guards govern **who may read a member's cadence**, never whether a beat
> may be recorded.

## 3. `validate_dose_proposal` — the lens at the moment of proposing

One RPC, two tiers, mirroring the access posture of the rest of distribution:

- **Envelope tier** — `validate_dose_proposal(product, amount, unit)`: anon-friendly
  pre-write check against the recommended envelope (`product_dose_units`). No member
  data, so it stays GRANTable to `anon`, exactly like its companion
  `get_product_dose_options`. Returns `low`/`high`/`info` warnings; never blocks.

- **Member tier** — add `…, p_member_distribution_plan_id`: reading a member's
  cadence is PHI, so it is held to the **same contract as `create_distribution_adjustment`**:
  authenticated **+** `consultant`/admin role **+** data-sharing consent (admin
  bypasses) **+** an audit-journal entry. It then adds `study_protocol_deviation`
  and `member_plan_deviation` warnings (proposed vs prescribed vs current).

So the access model is *consistent with the stack and roles*: the **envelope** is
public catalog data; the **member cadence** is trust-scoped (member-own, or a
consultant the member consented to, or an admin), audited — the same boundary the
`distribution_adjustments` flow already enforces.

## 4. Where it plugs in (today and next)

- **Today:** SoT `aisha/db/sql/functions/validate_dose_proposal.sql`, lives in the
  regenerated baseline (wipe-cold-start model), proven by pgTAP
  `aisha/db/tests/schema/02_validate_dose_proposal.sql`.
- **Consumers:** the envelope tier is for `DosingInput` / the mobile dose slider
  (pre-fill + soft warnings); the member tier is for consultant adjustment review
  (`useDosageAdjustments` → `create_distribution_adjustment`), validating a proposed
  re-tuning before it is authorized.
- **Deferred (own story, not invented here):** frequency/timing validation,
  proposal *approval* workflow, and the evaluation-jump scoring all live in
  plan-level RPCs over `member_distribution_plans` / `distribution_protocols` —
  this lens deliberately covers only the **amount of one beat**.
