---
slug: gpu-shared-lane-vllm-measured
title: "Shared vLLM lane on a GPU node: what leaks between tenants and what 'ready' means (measured)"
summary: "Measured with a pinned vLLM image: prefix cache leaks between clients unless every tenant gets its own cache_salt; /v1/models lists every tenant's adapter; /health 200 is not readiness (first request can exceed 60 s); --gpu-memory-utilization is a share of the whole card. Container GPU access works via CDI and --gpus; check that the image's architecture list covers the card."
category: operations
item_type: engineering_doc
tags: [gpu, vllm, lora, multi-tenant, prefix-cache, readiness, vram, isolation]
verified: read
verified_note: "two probe runs on 2026-10-05 against a pinned vLLM 0.30.0 image on a single 96 GB-class card; no tenant data: a public 0.5B base model and two random LoRA adapters built inside the container; every 'no hit' result had a same-run anchor that hit. The probe scripts and outputs are kept in a private repository (not re-run for this item); each rule below names its re-runnable gate"
evidence:
  - "procedure: rule 1 gate — two tenants send the same long prefix; cached_tokens of the second = 0; anchor: the same tenant twice > 0; mutant: salt off or taken from the client -> hit"
  - "procedure: rule 3 gate — GET /v1/models through the enforcement point as tenant A must not list tenant B's adapter; a request for B's adapter returns 404"
  - "procedure: rule 4 gate — after /health 200, send one warm-up request with a client timeout; ready only when it completes"
  - "procedure: rule 5 — read the engine process memory in nvidia-smi at a given --gpu-memory-utilization and compare with the card total"
valid_for: "vLLM 0.30.0 image pinned by digest; re-measure on any vLLM upgrade or a different card"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Use when designing, reviewing or operating a vLLM lane that serves more than one tenant (fork) on a shared GPU, and when writing its gates. Treat each rule as a contract requirement with its own test and anchor. Do not trust /health alone for readiness, never let a client choose its own cache_salt, never expose /v1/models unfiltered, and size VRAM as shares of the whole card. Re-run the probes before relying on these rules after an image upgrade."
---
# Shared vLLM lane on a GPU node (measured)

## Rules
1. **Prefix cache is shared across ALL callers unless salted per tenant.** [measured]
   - Two clients sent the same 1176-token prefix to the same base model. The second client got **1168 cached tokens**, i.e. a hit on the first client's prompt.
   - With a different `cache_salt` per tenant the hit was **0**. The same salt again hit 1168 (anchor).
   - The enforcement point in front of the lane must set `cache_salt` from the tenant identity established at the entry (network and tenant key), never from the request, and reject any salt sent by the client. Otherwise the cache must be off for that lane.
   - Gate:
     - two tenants with the same prefix → `cached_tokens` of the second = 0;
     - anchor: the same tenant twice → > 0;
     - mutant: salt off or taken from the client → hit.
   - The leak is a timing side channel (time to first token shows that someone already sent this prefix), not content.
2. **An adapter does not share prefix cache with the base, but that is not tenant isolation.** [measured] The same prefix on a LoRA adapter after the base gave 0 cached tokens, and the adapter twice gave 1168. The adapter identity is part of the cache key. Two tenants on the same base or the same adapter still share, so rule 1 applies regardless.
3. **`/v1/models` lists every loaded adapter to any caller.** [measured]
   - One server with two adapters returned `base, lora-a, lora-b` to an unauthenticated local call.
   - On a shared lane this reveals other tenants' adapter names.
   - The enforcement point must answer the model list per tenant (shared bases + own adapters only) and return 404 for a foreign adapter.
4. **`/health` 200 is not "ready".** [measured]
   - Without CUDA graphs (`--enforce-eager`), the server reported healthy after 140 s, but the first request did not return within a 60 s client timeout.
   - With CUDA graphs (default), it was healthy after 271 s (engine init 224 s: compile 23 s, graph capture about 2.4 min), and the first request then took 358 ms.
   - Readiness = `/health` 200 **and** a completed warm-up request.
   - A lane restart lasts minutes. Callers must report "lane starting" loudly as unavailability, not hang until their own timeout, and must never fall back to another model or to CPU.
5. **`--gpu-memory-utilization` is a share of the WHOLE card, not of free memory.** [measured]
   - At 0.25 the engine process held about a quarter of the card's total memory, matching vLLM's own target.
   - Two lanes with the default 0.9 cannot share one card.
   - Budget the node in absolute GiB and derive each lane's fraction from it, rounded down. The sum of the fractions plus a reserve must be ≤ 1.0, otherwise stop before deploying.
   - On a card without MIG partitioning (`nvidia-smi` reports MIG N/A) this budget is the only separation between lanes: enforce it per lane and treat an overrun as a stop, not a warning.
6. **Container GPU access and architecture.** [measured]
   - With NVIDIA Container Toolkit and a CDI spec on the host, both `--device nvidia.com/gpu=all` (CDI) and `--gpus all` exposed the GPU. A registered `nvidia` runtime in the Docker daemon is not required for that.
   - The pinned image listed the card's architecture in its arch list and ran fp16 matmul and multi-LoRA serving on it.
   - Check the arch list of any replacement image before deploying. A missing architecture does not always fail loudly (llama.cpp falls back to CPU).

## Why
A shared lane serves several forks at once. Isolation that is not enforced by the enforcement point does not exist: the server itself caches, lists and serves whatever any caller asks for. Rules 1–3 are the concrete places where one tenant could see or infer another tenant's activity. Rules 4–5 are where a naive deployment fails without anyone noticing: health that lies about readiness, and memory fractions that silently overcommit the card. Every rule here was measured with an anchor in the same run, so a 'no hit' result is evidence, not the absence of a measurement.
