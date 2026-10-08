---
slug: model-promotion-approval
title: "Promoting a model or adapter: Aisha approves, on measured evidence from the tenant's own data"
summary: "A new base, embedder or adapter goes live for a fork only after Aisha approves it on a measurement run inside that fork's lane, compared with the current model, optionally validated by a user in administration, and recorded."
category: model_operations
item_type: playbook
tags: [models, promotion, approval, measurement, embeddings, adapters]
verified: read
verified_note: "platform owner's decision of 2026-10-05 (promotion approved by Aisha, vector space chosen by measurement) and a measurement format, recorded in a private review repository"
evidence:
  - "owner decision of 2026-10-05 and the measurement format, recorded in a private review repository"
  - "procedure: one JSON line per run with the evaluation set checksum, recall@k, nDCG@10, latency, memory per vector and recompute cost; the same set and conditions for the current and the candidate model"
valid_for: "from 2026-10-05; until the owner changes the promotion rule"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Before promoting any model, embedder or adapter for a fork, require a machine test on that fork's own evaluation set inside its lane, a comparison with the current model, and an explicit approval record; never promote on numbers without a run log."
---
# Promoting a model or adapter

## Rules
1. **[read] Aisha approves every promotion,** optionally after a user validates it in administration.
2. **[read] The evidence is a machine test inside the tenant's lane** on the tenant's own frozen evaluation set (checksum), one JSON line per run: recall@k and nDCG@10 for retrieval, latency, memory per vector, cost of recomputing the corpus.
3. **[read] Compare with the current model on the same set and the same run conditions;** decide the tie rule (for example "if indistinguishable, cost decides") before the run.
4. **[read] The vector space is chosen by measurement,** not fixed in advance. Recompute all vectors under the new identity as a background batch that never blocks the tenant's interactive queries; switch queries only when 100 % of the space carries the new identity (count by identity in the database, not "the job finished"). Details: see knowledge item `embedding-backend-migration`; adapter identity and evaluation sample size: see `adapter-identity-and-gate-sample-size`.
5. **[read] Record the approval** (who, which run, which identity of weights) so that it can be rolled back.

## Why
Each fork gets its own deployment and Aisha approves promotions; without a fixed recipe, approvals would rest on impressions or on unlogged numbers.
