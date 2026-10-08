---
slug: ops-pull-through-cache-and-build-cache
title: "Image caches that grow on their own: registry pull-through cache and BuildKit cache"
summary: "A pull-through registry cache keeps every large image for its TTL and cannot delete; registry garbage-collect would remove foreign blobs. BuildKit cache from interrupted builds stays 'InUse' until dockerd restarts."
category: operations
item_type: engineering_doc
tags: [registry, pull-through-cache, buildkit, build-cache, disk, gpu-images]
verified: read
verified_note: "registry: a targeted deletion was done on 2026-10-03 with the owner's approval (disk 98 % -> 89 %); BuildKit: the hypothesis was confirmed by a dockerd restart on 2026-09-27 (reclaimable 42 MB -> 59.95 GB); measured on private nodes (not re-run for this item)"
evidence:
  - "procedure: registry proxy cache — scheduler-state.json key ExpiryData holds the TTL; the cache log field http.request.remoteaddr says who pulled; DELETE on a proxy registry returns 405"
  - "procedure: registry garbage-collect --dry-run on a proxy cache lists blobs referenced by other repositories' layers (207 listed, 133 of them still referenced)"
  - "procedure: docker buildx du --verbose shows InUse records and their last use; compare with the builds actually running"
  - "file: src/tests/gates/registry-proxy-centralni-domov.gate.test.ts — example of a gate that keeps image pins on the cache path, so any exception has to be written explicitly"
valid_for: "distribution registry in proxy mode; Docker with containerd snapshotter and live-restore=false"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Do not route very large images (model servers, GPU images) through a shared pull-through cache unless its disk is sized for them. Never run registry garbage-collect on a proxy cache. Treat large 'InUse' BuildKit cache with no running build as leaked references, fixable only by a dockerd restart in a window."
---
# Image caches that grow on their own

## Pull-through registry cache
1. **Every large image costs its size for a week.** [measured] One ~20 GB model-server image pulled through the cache by a GPU node moved the shared node from 87 % to 98 % in days. TTL is 7 days (`scheduler-state.json`, key `ExpiryData`).
2. **Proxy mode cannot DELETE.** [measured] The API returns 405.
3. **Never `registry garbage-collect` on a proxy cache.** [measured] The dry run listed 207 blobs, 133 of them layers of other images whose manifests GC does not mark; some can no longer be pulled.
4. **Targeted removal that worked:** [measured] list digests from `repositories/<repo>/_layers` and `_manifests/revisions`, subtract everything referenced by other repositories (`comm -23`), remove the repository directory and only the remaining blobs, then verify `/v2/` = 200 and a manifest of another image. Stale scheduler entries only log an error at expiry.
5. **Who pulled what** is in the cache log (`http.request.remoteaddr`); map the address to a server through the Coolify DB.
6. **Very large images should bypass a shared cache by an explicit, reasoned exception** written into the pin itself and reviewed, never silently. [read]

## BuildKit cache on the build node
1. **"InUse" does not mean "a build runs on it".** [measured] 60.9 GB of 68.8 GB InUse had not been used for weeks; running builds held 0.2 GB. The leaked references came from days with many interrupted builds (18 interrupted -> 22 GB).
2. **Only a dockerd restart releases them.** [measured] After the restart the whole cache became reclaimable. With `live-restore=false` the restart stops every container; services with `unless-stopped` come back, a CI runner restarts several times until its DinD is healthy (depends_on applies only to `compose up`). Done in ~40 s; needs a window and the owner.
3. **Age filters are wrong for images.** [measured] `--filter until=` measures the author's build date, not local use.
