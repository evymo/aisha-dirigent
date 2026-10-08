---
slug: evidence-vs-claim-model-numbers
title: "Numbers about models are claims until a logged run backs them"
summary: "Before choosing a base model, separate measured numbers (run with label and log) from distilled claims, and measure what the choice of a shared base actually needs."
category: engineering_practice
item_type: playbook
tags: [models, measurement, evidence, gpu, serving]
verified: read
verified_note: "derived from a survey of design documents and measurement records on 2026-10-05 in which three key claims were checked by hand and found unlogged; the survey is kept in a private review repository. General measurement rules live in measurement-proves-it-measured; this item covers only what is specific to choosing models"
evidence:
  - "one recorded survey (private review repository, 2026-10-05): training and multi-adapter numbers in circulation had no run label or log behind them"
  - "procedure: for every number in a model comparison, find the run label, date and log; a number without them is a claim"
valid_for: "general method; the concrete state changes with each measurement"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When asked to choose or compare models, list for each number whether it comes from a logged run (label, date, log) or is a distilled claim; treat claims as hypotheses and plan the measurement that would confirm them."
---
# Numbers about models are claims until a logged run backs them

## Rules
1. **[read] Mark every number:** measured (run with label, date and log), claimed (no run evidence), estimate, or plan.
2. **[read] A distilled summary without labels and logs is not evidence for a decision,** however precise it looks.
3. **[read] Measure what the decision needs:** for a shared lane, memory and throughput of all lanes at the same time (not summed separately), concurrency with training, and quality on the tenant's own data.
4. **[read] Keep one living "what is measured" document** and update it with each run; list contradictions between documents instead of picking one silently.

## Why
General rules for measurements are in `measurement-proves-it-measured`; this item adds what is specific to models. In one survey before the first probe on a GPU node, all training and multi-adapter numbers turned out to be an unlogged distillate, and no serving or embedder-quality number had been measured. Choosing on them would have been choosing on impressions.
