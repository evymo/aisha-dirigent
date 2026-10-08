---
slug: ci-green-from-job-conclusions
title: "CI is green by job conclusions, not by the combined commit status"
summary: "Decide that CI passed from the conclusions of all jobs as the server records them in the Actions API; a commit status can be written from inside a job, so a green combined status is not evidence."
category: operations
item_type: playbook
tags: [ci, forgejo, actions-api, verdict]
verified: read
verified_note: "reading of the Forgejo Actions model; not re-run for this item"
evidence:
  - "procedure: compare GET …/commits/{sha}/status with GET …/actions/runs?head_sha={sha} and its jobs; only the jobs carry the server-recorded conclusions"
valid_for: "Forgejo Actions and similar forges where a job token can write commit statuses"
scope: general
status: proposed
author: platform-maintainers
ai_instructions: "Decide 'CI is green' from the conclusions of all jobs via the Actions API, never from the combined commit status."
---
# CI is green by job conclusions

## Rules
1. **Green = job conclusions, not combined status.** [read] A commit status can be written from inside a job; only the job conclusions the server records count as the result.
