# Recurring Interaction Cadence — the model behind "dosing"

> **Key insight (from user feedback):**
> "Dosage" is misleading. The platform is not really about medication amounts —
> it models a **recurring, planned interaction**: something a member commits to
> *on a cadence*, realizes over time with their own choices and notes, visible
> only to those they trust. The load-bearing axis is **how often the interaction
> happens — its FREQUENCY** — not "how much medicine".
>
> A medical dose is just **one instantiation**. The same model is the *frequency
> of interactions* for anything recurring: a daily check-in, a practice session,
> a reminder, an engagement beat, a study touch-point. **No new concept, no new
> tables** — this doc unifies the existing `dose_*` / `distribution_*` primitives
> under one abstraction so the naming stops being confusing.

This is the same move as the [Universal Member Model](../audience/UNIVERSAL_MEMBER_MODEL.md):
a confusing surface name is one manifestation of a single existing model, surfaced
as a lens.

---

## 1. One interaction, two axes

A **recurring interaction** is described by two orthogonal axes:

```
                 FREQUENCY  (how often — the cadence)
                 doses_per_day · dose_timing · recurrence
                          ▲
                          │        ● a planned interaction
                          │       (frequency × intensity)
                          │
                          └──────────────►  INTENSITY (how much per beat)
                                            dose_amount · product_dose_units bounds
```

- **FREQUENCY / cadence** — *how often* the interaction recurs and *when*
  (`doses_per_day`, `dose_timing`, recurrence). This is the abstraction the term
  "dosage" obscures: it is really an **interaction frequency**.
- **INTENSITY / magnitude** — *how much* in one beat (`dose_amount`, bounded by
  `product_dose_units`). For a non-medical interaction this is "effort / length /
  weight" of one occurrence; for many interactions it is simply `1` (it either
  happened or it didn't), leaving frequency as the only meaningful axis.

"Dosing" is the case where both axes are numeric and medical. **Generalize the
naming and the same shape covers any recurring interaction** — the frequency is
always there; the intensity collapses to a yes/no when the interaction has no
magnitude.

## 2. The lifecycle (prescribe → realize → evaluate)

| Stage | Technical (medical surface) | Concept (general) | Who |
|---|---|---|---|
| **Recommended envelope** | `product_dose_units` (min/max/default/step) | soft bounds for one beat's **intensity** | public / anon |
| **Prescribed cadence** | `study_distribution_protocols` (`dose_amount`, **`doses_per_day`**, **`dose_timing`**, arm) | the **frequency × intensity** a study/program prescribes | study-scoped |
| **Member realization** | `member_distribution_plans` (+ `custom_dose_amount`, **`custom_doses_per_day`**, notes) | the member's *chosen* cadence + their overrides and notes | member-own + trusted consultant |
| **Trust-scoped re-tuning** | `distribution_adjustments` (`new_dose_amount`, reason, authorized_by) | a consultant adjusting the cadence under consent | consultant/admin + consent + audit |
| **Realized beats** | `dosing_logs` | the interactions that *actually happened* (free-form, real-world) | member-own + consented consultant |
| **Evaluation jumps** | compliance / streak / escalation over realized vs prescribed | did the member keep the **frequency**? — keyed to study (= trust) involvement | derived |

> A member's enrolment in a **study** is, semantically, **trust**: the involvement
> that decides *who may see and re-tune* their cadence, and which **evaluation
> jumps** (compliance, streaks, escalation) apply. "Study" is the entity; "trust"
> is what it means.

## 3. Why nothing ever blocks

The platform collects **real-world** data. The envelope and the prescribed cadence
are *advisory* — a member may legitimately interact more, less, or off-schedule,
and that signal is the point. So the system **warns, never blocks**. Access guards
govern **who may read a member's cadence**, never whether a beat may be recorded.

## 4. Where `validate_dose_proposal` sits

It is the **advisory check at the moment of proposing one beat** — today it
validates the **intensity** axis (amount vs `product_dose_units`), with the
optional member tier adding study-/plan-deviation warnings under the dosing access
contract (auth + consultant/admin role + data-sharing consent + audit). See
[DOSING_AS_DISTRIBUTION_CADENCE.md](DOSING_AS_DISTRIBUTION_CADENCE.md) for the RPC
detail.

**The FREQUENCY axis is the natural next unification:** `doses_per_day` / timing /
recurrence validation and the *frequency*-deviation warnings belong in the same
lens, read from `study_distribution_protocols` / `member_distribution_plans`. That
is a focused follow-up (its own RPC + tests), not invented here — but this doc is
the shared vocabulary it should land in, so "dose" reads as **"one beat of a
recurring interaction,"** and the model reads as **interaction frequency**, not
medicine.
