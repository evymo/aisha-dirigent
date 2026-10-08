---
slug: shared-gpu-job-runner-rules
title: "One shared GPU, many jobs: queue, cleanup and evidence"
summary: "Rules for a job wrapper on a single shared GPU: the lock, the cleanup and the per-label log must not be able to destroy another job or another job's evidence."
category: model_evaluation
item_type: playbook
tags: [gpu, queue, lock, cleanup, evidence, tenant-isolation]
verified: read
verified_note: "rules 1-5 and 7 were measured by a probe over a copy of a job wrapper with a simulated docker, kept in a private review repository (not re-run for this item); rules 6 and 8 are reading"
evidence:
  - "procedure: re-measure rule 1 by starting two jobs with different lock paths; the second job's cleanup must not remove the first job's container"
  - "procedure: re-measure rule 4 by sending TERM to a running job; no container with the job's label may remain on the GPU afterwards"
  - "procedure: re-measure rule 5 by starting a container without the label inside a job; the job must fail, not report success"
valid_for: "general rules for any job wrapper on a GPU shared by several jobs or tenants"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When proposing, running or reviewing GPU jobs (training, benchmarks, serving measurements) on a shared node, apply these rules; do not accept a measured number whose label was reused or whose run did not verify an empty card."
---
# One shared GPU, many jobs: queue, cleanup and evidence

## Rules
1. **Cleanup must know whose containers it removes.** [measured] "Remove everything with the layer label because I hold the lock" is safe only if every job uses the same lock path. A job started with another lock path (an overridden variable, a container without the lock directory mounted) removed a running job's container. Put the lock identity into the label and treat a foreign one as an error.
2. **One label, one run, one log.** [measured] Re-using a label while the first run is still active put the first run's verdict into the second run's log. Refuse a label that is queued or running; name logs with a timestamp.
3. **Three repetitions need three labels.** [measured] Otherwise each repetition overwrites the evidence of the previous one.
4. **Clean up on interruption too.** [measured] After TERM/INT the verdict line was written but the job's container stayed on the GPU.
5. **Enforce the label, do not just offer it.** [measured] A container started without the label survived the job and the job still reported success.
6. **A lock does not mean the card is free.** [read] Serving lanes and processes outside containers do not hold the lock. Measure the card (used memory below a threshold, no foreign process) before every run.
7. **Queue files must not be writable by everyone.** [measured] A ticket carrying the pid of any long-lived process blocked the queue.
8. **Secrets only through the environment.** [read] The full command line goes to the log.

## Why
The wrapper was written after two trainings ran out of memory because a server from a previous step stayed on the card. The same class of failure remained reachable through the edges above.
