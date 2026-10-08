---
slug: ops-deploy-speed-build-cache-and-transfer
title: "Why a stack deploy is slow: the build cache is defeated by injected ARGs, images travel whole"
summary: "Build and image transfer dominate deploy time; RUN steps rarely hit the build cache when a build variable injected as an ARG declaration into every stage changes on every deploy (the commit id); a build server that ships images with docker save/load copies unchanged layers again. Measure before and after any change."
category: operations
item_type: engineering_doc
tags: [deploy, build-cache, buildkit, coolify, image-transfer, self-evaluation, performance]
verified: read
verified_note: "the phase split and cache ratio were measured from Coolify deploy logs over 24 h (116 builds) and on two deploys of one 13-image stack on 2026-10-04 with a deployment meter kept in a private infrastructure repository (not re-run for this item); the levers are proposals whose gain is not measured"
evidence:
  - "file: Dockerfile.web — example of a Dockerfile that declares the build variable it reads (ARG GIT_SHA) before using it, the condition for switching ARG injection off"
  - "procedure: in a deploy log count RUN steps reported as CACHED vs rebuilt"
  - "procedure: the Coolify application setting inject_build_args_to_dockerfile controls the injection; compare RUN cache hits on two deploys of one commit with it on and off"
valid_for: "Coolify 4.x compose builds, verify on your version; re-measure after any lever lands"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When asked why deploys are slow or when evaluating your own delivery speed, measure the deploy phases and the RUN cache ratio over a window and compare with the instance's own baseline before proposing changes; after a change, report the same metrics on the same window length. Do not claim a speed-up from one deploy."
---
# Why a stack deploy is slow

## Where the time goes [measured]
- Across 24 h of deploys on one fleet, build took about half of the deploy time and image transfer about a third; waiting, preparing and starting together the rest.
- One 13-image stack deployed without forced rebuild spent ~10 min building and ~3 min transferring, then ~2 min removing old containers. A deploy with forced rebuild (`--no-cache`) took the same time — the cache was not helping either way.

## Why the cache does not help [measured]
1. **RUN steps almost never hit the cache:** 7 % fleet-wide, 0 of 96 on the stack above. FROM, WORKDIR and COPY do hit it (the lockfile COPY was cached, the `npm ci` right after it was rebuilt).
2. **Injected ARGs are in the cache key of RUN.** A control plane can add build variables as ARG declarations to every build stage. When any of them differs between deploys, every RUN after the declaration is rebuilt. COPY is not keyed by ARGs, which is exactly the observed pattern.
   - **The value that changes is the commit id.** Of the build-time variables only `GIT_SHA` is rewritten at every deploy (its `updated_at` equals the deploy time); the deploy pipeline sets it. One new commit therefore invalidates every RUN of every stage of every service.
   - **The control plane has its own switch** `inject_build_args_to_dockerfile` ("preserves Docker build cache"). Turning it off is safe when every Dockerfile declares the build variables it reads. Keep it that way with a gate before switching injection off.
3. **A from-source build with a fixed version is rebuilt every time** (object-store server 5-7 min, client ~3 min) because its stage gets the same ARGs.
4. **Whole images travel.** A build server that ships images with `docker save` -> `docker load` copies unchanged layers (a ~0.5 GB `node_modules` per service) again on every deploy.
5. **Dockerfiles that copy the whole source before `npm ci`** invalidate the install layer on any source change, even with a working cache.

## Levers, in order of expected gain [read: proposals, gain unmeasured]
1. Keep every Dockerfile declaring the build variables it reads (a gate compares reads with declarations per stage), then switch off ARG injection per compose application, delivered from the instance declaration, not by hand — this restores RUN caching.
2. Prebuild from-source third-party images once per version, push to the registry and pin by digest.
3. Copy only package manifests before `npm ci`, then the source (helps only after lever 1).
4. Transfer through a registry (push/pull moves only changed layers) instead of save/load.
5. Build once in CI and deploy by image reference.

## How to evaluate yourself [read]
Metrics per window: phase shares and medians, RUN cache ratio, the five most expensive rebuilt steps. Keep your own dated baseline. A lever counts as done only when the same window shows the change.
