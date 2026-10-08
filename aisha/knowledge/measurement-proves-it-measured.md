---
slug: measurement-proves-it-measured
title: "Measurement that proves it measured"
summary: "A gate or probe may report clean only if the same run proves it could have reported a finding. Unmeasured is a separate verdict, never clean."
category: engineering_practice
item_type: playbook
tags: [gate, probe, measurement, verification, false-clean]
verified: read
verified_note: "every rule comes from a probe whose anchor caught a wrong green result; the probes are kept in a private review repository (not re-run for this item). Examples of rules 1-3 and 5 in code: see evidence"
evidence:
  - "file: scripts/lib/beh-nic-nezmeril.mjs — example: a run that measured nothing is reported as unmeasured, not as a finding and not as green"
  - "file: scripts/test/run-vitest.mjs — example: exit code 75 = UNMEASURED (no evidence left after the run), distinct from 0 and 1"
  - "file: scripts/ci/ci-verdikt.mjs — example: a CI verdict with a separate 'unknown' outcome; green is read from job results, not from a status the job can write itself"
valid_for: "general method; no expiry"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When writing, reviewing or interpreting any gate, probe, test or review conclusion, check these rules; if one is not met, report the result as unmeasured and name the missing rule."
---
# Measurement that proves it measured

## Rules
1. **Anchor in the same run.** [measured] Before the real cases, run one case that must produce a finding and one that must pass. If the anchor fails, the verdict is "unmeasured", not "clean".
2. **Unmeasured is not clean.** [measured] Three verdicts: clean, finding, unmeasured. A tool error, an empty input or an unreachable endpoint is unmeasured.
3. **A negative check needs a positive anchor.** [measured] "The line is not in the output" also passes on an error page. Require exit code 0 and a known line in the same output.
4. **Both orders.** [measured] A concern that depends on order (trigger order, registration, concurrency) is refuted only by a probe in both orders.
5. **Never read a gate's result through a pipe.** [measured] `gate | tail` returns the exit code of `tail`. Write the code to a file and read the verdict line.
6. **Two independent searches for "all places".** [measured] One pattern found 19 call sites, the owner's pattern found 25. Neither list alone was complete.
7. **Verify the probe before trusting it.** [measured] A first probe signalled a subshell instead of the script and measured nothing; a second flipped more objects than a real attacker would and hit an unrelated defence. Both were caught only because the anchor failed loudly.
8. **Say what was read and what was run.** [measured] Every finding carries "verified by experiment" or "read only", and what was not looked at.

## Why
Each rule comes from a case where a green result was wrong: a compatibility check that passed with the same endpoint on both sides, a guard that reported clean over a database with findings, a probe that measured its own mistake.
