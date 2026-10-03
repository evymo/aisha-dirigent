# The Twin Pulse — one model for every domain that follows something up

> **Status:** implemented core, documented mapping. The carriers named below exist in
> `aisha/db/sql/`; the per-domain wiring column in §5 marks what is generated today and
> what a domain still triggers by hand.
> **Scope:** OSS core, instance-agnostic. Nothing here is specific to any tenant, and no
> concept below is allowed to carry a domain word.

## Why this exists

Seven features in this stack are the same feature:

a supplement dose that must be taken · a practice a member committed to · a machine's
service interval · a production milestone awaiting confirmation · a periodic operational
assessment · a questionnaire round · a CRM follow-up.

Each of them was read as its own subsystem, so each grew its own tables, its own notion
of "due", its own way of recording that it happened, and its own idea of who is
responsible. The cost is not duplication for its own sake — it is that a question like
*"what does this thing owe right now, and who owes it?"* has to be asked seven different
ways, and a new domain starts from zero.

They are one loop over a **digital twin**, and the loop has four strokes.

## 1. The twin

A twin is the digital projection of a real subject — a person, an organisation, a place,
a machine, a batch. The projection is not a metaphor and not a card in a list: **the
existence of the record in the system IS the relation**, and it is through that record
that the system deals with the subject.

A twin therefore carries state (who/what it is, its properties, its tier) and it carries
a pulse (what it currently owes). Everything else in this document is about the pulse.

Twins are addressed **polymorphically**: `(subject_type, subject_id)`. That pair is the
whole address — `actor` for a person, `story` for an organisational context, and
whatever kinds an implementation adds (`equipment`, `batch`, …). There is no foreign key
on the pair by design; the writing RPC validates existence per kind. This is the same
axis `story_entries` already uses, and it is the reason a machine needs no user account
to have a timeline.

## 2. The four strokes

```
REGIME  ──►  BEAT  ──►  CONFIRMATION  ──►  RECOMPUTE
(what      (what is    (what actually    (what that
 should     owed, by     happened)         changes about
 hold)      when, by                       the twin)
            whom)
                └──────────── the recompute may open the next beat ───────────┘
```

| Stroke | Question it answers | Carrier | Generic? |
|---|---|---|---|
| **Regime** | What should hold for this twin? | domain-shaped (a dosing plan, a milestone definition, an assessment cadence, a campaign schedule) | **No, and that is correct** — a dose is not a service interval |
| **Beat** | What is owed, by when, by whom? | `story_pulse_beats` | **Yes** — the one carrier that was missing |
| **Confirmation** | What actually happened? | `story_entries` (typed record on the twin's axis) | Yes |
| **Recompute** | What does that change? | domain scoring (`member_compliance_scores`, tier derivation, health states, …) | No — the meaning of "doing well" is domain-owned |

Two strokes are deliberately domain-shaped and two are deliberately universal. That split
is the whole design: the middle of the loop is where every domain says the same thing, so
the middle is where the platform provides one carrier and one vocabulary.

## 3. Why the beat needed a new carrier

The beat is the sentence *"subject X owes an action of type T by time D, and person P is
the one who owes it."* Two existing tables look like they could carry it and cannot:

- **`user_reminders`** is keyed on `user_id NOT NULL`, which is simultaneously the subject
  and the addressee. That conflation holds only while the subject is the person who acts.
  A machine has no `user_id`, and its service beat is owed by a technician; a member's
  follow-up is owed by a coordinator. The moment subject ≠ addressee, the table cannot
  express the fact.
- **`story_reminders`** lives on the story axis only (`story_id` + `partner_id`, both NOT
  NULL) and names no addressee at all.

Hence `story_pulse_beats` — the same polymorphic axis, an open `beat_type`, an addressee
separate from the subject, and `(source_type, source_id)` pointing back at the regime that
produced it.

**A beat is a ledger entry, not a message.** How someone is told — push, e-mail, an
operator queue — stays with the existing notification paths. Introducing beats therefore
cannot double-send, and a domain can adopt the ledger before it adopts any delivery.

## 4. What happens where

| Action | Function | Who may |
|---|---|---|
| Open a beat | `create_pulse_beat_audited` | operators for any twin; a person for their own twin |
| Settle a beat with a confirmation | `close_pulse_beat_audited` | operators, the addressee, or the subject |
| Write a typed record on a twin's timeline | `append_subject_entry_service` (internal primitive) | service/definer only — never a member session |
| Read a twin's timeline | `get_subject_timeline` | operators for any twin; a person for their own, internal records excluded |
| Grant / end a contextual role | `grant_story_role_audited` / `revoke_story_role_audited` | operators, or the story's partner (self-revoke allowed) |

Three rules hold across all of them, and each exists because its absence has already cost
something here:

1. **Authorization binds the SUBJECT, never the addressee.** Gating on "this is addressed
   to me" would let any caller write onto a stranger's twin by addressing the work to
   themselves — the caller-controlled-id class closed in #797.
2. **Attribution is the writer, the subject is the axis.** A record about a member,
   written by an operator, belongs on the member's timeline authored by the operator. The
   older path put such records on the *operator's* story, because the promotion could only
   build a story for partner-tier actors (V4 gap F18a).
3. **A side effect must never destroy the act.** Spine writes hang off audited operator
   actions inside a nested exception block that warns instead of aborting — an
   AFTER-INSERT trigger once broke four admin RPCs at once by ignoring this.

## 5. The same loop, seven times

| Domain | Regime (what should hold) | Beat (`beat_type`) | Confirmation | Recompute | Beat generated today? |
|---|---|---|---|---|---|
| Supplement dose | `member_product_plans` (`dose_amount`, `doses_per_day`, `dose_timing[]`) + `distribution_protocols` | `dose` | `member_product_logs` + typed record | `member_compliance_scores` | no — plan → beat is the open joint |
| Member practice / programme | `user_reminders` (frequency, days, time-of-day) | `practice` | `reminder_completions` (+ `quick_response`) | streaks, engagement metrics | no — existing reminder path still fires it |
| Machine service cycle | `production_milestones` / maintenance interval | `service_check` | typed record + assessment result | equipment state | no — needs the interval → beat joint |
| Production milestone | `production_flow_nodes` / milestone definition | `milestone` | `production_flow_records` + confirmation | batch state, yield | no |
| Operational assessment | `operational_assessments` + dimensions | `assessment` | `questionnaire_responses` / assessment row | assessment score | no |
| Questionnaire round | `questionnaires` + versions | `questionnaire` | `questionnaire_responses` | gating (e.g. registration activation) | no — dispatch is questionnaire-owned |
| **CRM follow-up** | operator intent (an ad-hoc regime of one) | `follow_up` | typed record on the actor's timeline | queue state, engagement | **yes — implemented** |

Read the last column honestly: the ledger and its vocabulary exist for every row, and one
row generates beats end-to-end today. Each remaining row is a small, isolated joint —
"when the regime says the next occurrence is due, open a beat" — and deliberately not a
rewrite of a working dispatcher. Doing all seven at once would double push volume and
rewrite three functioning delivery paths in one change; doing them one at a time is a
day's work each with its own test.

## 6. What an implementation supplies

Nothing structural. An implementation seeds:

- the **kinds** its twins come in (`subject_type` values beyond `actor`/`story`),
- the **beat types** it uses (`follow_up`, `dose`, `service_check`, …) — plain strings, no
  schema change,
- the **regimes** themselves (its plans, milestones, cadences),
- and the **catalogue entries** its operators pick from.

`entry_type_definitions` is intentionally NOT where pulse record types are registered: it
is the composer's registry of *discussion post types*, and it is the only type gate on
`create_discussion_entry_audited`, which every authenticated member may call. Seeding
system record types there would hand members a way to mint them.

## 7. Where to look

| Concern | Path |
|---|---|
| Beat carrier | `aisha/db/sql/tables/story_pulse_beats.sql` |
| Beat verbs | `aisha/db/sql/functions/{create,close}_pulse_beat_audited.sql` |
| Spine write primitive | `aisha/db/sql/functions/append_subject_entry_service.sql` |
| Timeline read | `aisha/db/sql/functions/get_subject_timeline.sql` |
| Contextual roles | `aisha/db/sql/functions/{grant,revoke}_story_role_audited.sql` |
| Follow-up convergence | `aisha/db/sql/functions/audience_admin_{create,complete}_followup.sql` |
| Proof | `src/tests/db/twin-pulse-convergence.test.ts` |
| Upgrade path for existing DBs | `aisha/db/heals.sql` (mirrored, idempotent) |
