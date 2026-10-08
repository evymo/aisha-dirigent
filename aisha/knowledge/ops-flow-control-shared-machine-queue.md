---
slug: ops-flow-control-shared-machine-queue
title: "Flow control on one shared machine: a semaphore with lanes, dependencies and detached jobs"
summary: "Many agent sessions on one machine share heavy work (type checks, test suites, installs, pushes with pre-push) through one FIFO semaphore with mandatory lanes; short jobs take the express lane, chains use explicit dependencies, long jobs run detached."
category: operations
item_type: playbook
tags: [flow-control, queue, semaphore, heavy-jobs, scheduling, agents]
verified: read
verified_note: "measured on one machine shared by about ten agent sessions: before lanes (window ending 2026-10-03 morning) 661 of 800 heavy-lane jobs ran under 300 s and waited 71 h in total; a later 24 h window to 2026-10-04 morning had 714 jobs, 36 h of run time and 79 h of waiting; lane rules were measured against the semaphore script with mutants. The script and its journal are not public (not re-run for this item)"
evidence:
  - "procedure: before load-based fixes, record load and swap with and without the semaphore (without it: load 52-64 and swap 12.9-15.4 GB on one day)"
  - "procedure: from the queue journal, count jobs per lane that finished under the express cap; a high share in the heavy lane means misfiled jobs"
  - "procedure: verify a submitting tool through the real queue plus mutants (no lane, express cap exceeded, refused job reported as passed)"
valid_for: "any machine where many agent sessions share CPU-heavy work; general principle"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Wrap every heavy local command (tsc, test suites, eslint over a repo, npm ci, builds, commit and push hooks) in the shared semaphore with an explicit lane; put short checks in the express lane, chain with explicit dependencies instead of polling loops, and run anything longer than the tool limit detached with a log. Enqueue early and do other work while waiting."
---
# Flow control on one shared machine

## Rules
1. **One semaphore for everyone, two slots, FIFO.** [measured] Without it four type checks, test runs, lint and a VM at once pushed load to 52-64 and swap to 15 GB. Two semaphores coordinate nothing: there must be exactly one.
2. **The lane is mandatory.** [measured] heavy (CPU), short (<= 300 s, express, no git commit/merge/push inside, enforced by a git shim), long (push with the full pre-push suite), remote (waiting on a server). Before lanes existed, 661 of 800 heavy-lane jobs ran under 300 s and waited 71 h in total.
3. **The scheduler rejects misfiled jobs.** [measured] A command that ran >= 3 times with p90 < 240 s is refused in the heavy lane while the express lane is free; declare a known long run explicitly.
4. **Dependencies are explicit.** [measured] A declared predecessor (by pid or label) replaces `while kill -0` loops; a label like "after round 16" written in prose enforced nothing and a push overtook the one it should follow. A failed dependency stops the chain.
5. **Long jobs run detached.** [measured] A push started as a background job of the agent tool was killed by the tool's 2 h limit mid-suite. Detach (setsid) with a log file, verify the result in the log and, for pushes, with `git ls-remote`.
6. **The toolchain comes from the repository.** [measured] Jobs take Node from `.nvmrc` of the directory they are started from; started above the repo they ran under a wrong major version. Start jobs from the worktree.
7. **A heartbeat, not a pid, proves a holder lives.** [read] A slot is taken away only when its holder's heartbeat stops for > 120 s while the machine's clock kept ticking; a sleeping laptop does not kill all holders.
8. **Every threshold needs a way out.** [measured] A job waiting for `load < 14` waited 90 min; load never fell below 40 with ten sessions queued. An unreachable threshold punishes those who obey it.
9. **The queue cannot hand a place to a named session.** [read] "I will free a slot for you" cannot be delivered; changing that is a policy decision of the owner.

## A tool that submits work to the queue
10. **No lane = refused = not run.** [measured] A job without a lane is refused; a refused job has NOT run - report it as UNMEASURED, never as passed or failed.
11. **Follow the queue's advice in order.** [measured] heavy -> (refused as "known short") express -> (killed by the express cap) heavy with the explicit "I know it is long" flag, in a fresh working directory. Handle each refusal code explicitly.
12. **The bypass flag is not a default.** [measured] Hard-coding "I know it is long" defeats the lanes: short jobs would wait behind long suites again.

## Why
The machine is shared by a dozen sessions; without flow control they starve each other and every push re-measured the same code several times.
