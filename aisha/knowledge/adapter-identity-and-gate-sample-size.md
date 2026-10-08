---
slug: adapter-identity-and-gate-sample-size
title: "Adapter identity and how many examples a quality gate needs"
summary: "An adapter is identified by the bytes of its two files; its quality gate needs a disjoint, recorded holdout that is large enough, a paired comparison and a bare-base anchor."
category: model_evaluation
item_type: playbook
tags: [lora, adapter, identity, holdout, sample-size, gate]
verified: read
verified_note: "rules 5-7 are arithmetic and can be checked from the formulas given; rules 1-4 and 8 are definitions agreed between a tenant and the operator of a shared model layer, recorded in a private review repository"
evidence:
  - "procedure: rule 5 = binomial standard error ~ 1/sqrt(n); rule 6 = one-sided sign test (5 discordant pairs all in one direction give p = 1/32 ~ 0.031; 4 give 1/16 = 0.0625); rule 7 = rule of three (95 % upper bound 3/n for zero events in n trials)"
  - "procedure: rule 1 can be re-derived by hashing adapter_config.json and adapter_model.safetensors and hashing the two-line manifest"
valid_for: "general; check whether your serving layer reports the identity of the adapter it loaded (rule 2) before trusting that an adapter ran"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When an adapter is trained, converted, deployed or evaluated, require the byte identity, a holdout recorded by hash before training, and a frozen threshold; if the holdout is too small to decide, report unmeasured with the count instead of pass."
---
# Adapter identity and how many examples a quality gate needs

## Rules
1. **Identity = `peft:<sha256 of manifest>`.** [read] The manifest is exactly two lines in fixed order, `<sha256><two spaces><file name>`, for `adapter_config.json` and `adapter_model.safetensors`. It is a byte identity: never re-serialise the files. A hash of tensors alone is not an identity (strength, target modules and base revision live in the config).
2. **The serving layer computes identity from the files it loaded,** not from the declared value, and returns it with the answer. [read] Until it does, "the adapter ran" is unproven.
3. **Bare base as an anchor.** [read] Measure the base without the adapter on the same examples; it must come out worse. A request sent to the base name instead of the adapter name runs without the adapter and nothing fails.
4. **Holdout recorded before training.** [read] Fixed split with a seed; store sha256 of both parts, counts and class distribution next to the adapter. If the split was never recorded, earlier numbers are an upper estimate only.
5. **Size decides, not repetitions.** [measured: arithmetic] Three repetitions measure run noise. Sample uncertainty is about ±1/√n: ±35 points at n=8, ±14 at n=50, ±10 at n=100.
6. **Paired comparison.** [measured: arithmetic] Same examples for base and adapter; count discordant pairs; one-sided sign test. Fewer than 5 discordant pairs cannot reach p ≤ 0.05.
7. **Precision claims need counts.** [measured: arithmetic] Zero errors in n extractions gives an upper error bound of 3/n: "precision ≥ 0.97" needs at least 100 error-free extractions.
8. **Freeze the threshold and the minimum size before measuring;** below the minimum the gate says unmeasured. Only clean ground truth belongs in the gate. [read]

## Why
A tenant's adapter gate had been measured on 7–8 examples with an unrecorded split, and the worse of two adapters was the one deployed.
