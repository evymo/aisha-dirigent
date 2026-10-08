---
slug: deciding-between-colleagues
title: "When two recommendations disagree: name what each protects, look for a variant that keeps both"
summary: "A disagreement between two advisers usually means two valid concerns. Name them, look for a variant that keeps both (never trading a security or isolation invariant), let each side state its conditions, then decide with the owner."
category: collaboration
item_type: playbook
tags: [decisions, conflict, architecture, collaboration]
verified: read
verified_note: "one observed case on 2026-10-05 (a model-mesh design: an operations view and an isolation view recommended opposite modes; a third variant kept both and both sides accepted it with conditions), recorded in a private review repository; a pattern, not yet repeated"
evidence:
  - "one recorded case (private review repository, 2026-10-05): opposite recommendations, a third variant, conditions from both sides, decision with the owner"
  - "review note on the case: a variant that weakens a security invariant is not a compromise but a loss of the invariant"
valid_for: "general"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When two sessions or advisers recommend opposite options, write down what each one protects, propose a variant that keeps both, ask both for conditions, and only then decide with the owner; never trade away a security or isolation invariant, and do not pick the side of the last message."
---
# When two recommendations disagree

## Rules
1. **[read] Name what each side protects** (for example: operations wants a stateless node without public entry; the owner of a shared layer wants isolation by shape).
2. **[read] Look for a variant that keeps both;** ask both sides whether it does. If one concern is a security or isolation invariant, it is not traded: the variant must keep it fully, otherwise that side wins.
3. **[read] Collect each side's conditions** and make them part of the decision.
4. **[read] Decide with the owner,** and record the decision so that it can be reopened if someone sees a risk nobody named.
5. **[read] Admit your own lean when it was wrong** and say what corrected it.

## Why
Two advisers recommended opposite modes for the same design; both were right about different risks. A third variant kept both concerns, and both accepted it with conditions. The first lean of the one deciding had missed a decisive identity issue.
