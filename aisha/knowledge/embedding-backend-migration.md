---
slug: embedding-backend-migration
title: "Moving embeddings to another backend"
summary: "The same model name on another backend is not the same vector space. Recompute the whole corpus under a new identity, then switch queries; a compatibility check is not a switch gate."
category: rag
item_type: playbook
tags: [embeddings, vector-space, migration, identity, rag]
verified: read
verified_note: "rules 4-6 were measured by a probe with a fake fetch, kept in a private review repository (not re-run for this item); rules 1-3, 7 and 8 are agreements and reading"
evidence:
  - "file: aisha/db/sql/tables/knowledge_embeddings.sql — every vector carries its model identity (model, model_version, model_registry_id), which is what rule 8 counts"
  - "procedure: re-measure rule 4 by pointing both sides of a compatibility check at the same endpoint; a correct check refuses to run instead of reporting the same space"
  - "procedure: re-measure rule 6 by naming an API key variable that is not set; a correct check fails instead of sending the request without a key"
valid_for: "general"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When a tenant's embedding model, weights format or serving backend changes, recommend recomputing all vectors under a new identity before switching queries, and refuse to treat a small-sample similarity check as proof that spaces can be mixed."
---
# Moving embeddings to another backend

## Rules
1. **Recompute, then switch.** [read] Recompute all vectors once on the new backend under a new identity, verify by counting vectors per identity in the database, then switch queries. Cost = number of items × measured vectors per second.
2. **Identity is more than the weights hash.** [read] It includes the weights format and the text recipe (query vs passage prefix, chunking recipe). Vectors with different recipes are different spaces.
3. **Two thresholds, two questions.** [read] Self-consistency (same weights file, e.g. 0.999) and compatibility of different weights (e.g. 0.99) must not be merged into one number.
4. **A compatibility check must prove it compares two backends.** [measured] With the same endpoint on both sides the check reported "same space". Refuse identical endpoints and record both backends' model identity.
5. **The sample must exercise the risk.** [measured] A built-in sample whose longest text was about 300 characters cannot see truncation differences. Use the tenant's own corpus, including its longest chunks.
6. **A named key that is missing is an error.** [measured] The check silently sent the request without a key and passed; an open lane would look fine.
7. **Twenty generic sentences say nothing about top-k in a 100k corpus.** [read]
8. **"100 % under one identity" is a database count, not "the job finished".** [read]

## Why
Mixing spaces breaks retrieval silently: results are returned, only worse. On one tenant about half of the vectors carried the declared identity before the move.
