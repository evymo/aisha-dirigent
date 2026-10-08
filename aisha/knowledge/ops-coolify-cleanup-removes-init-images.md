---
slug: ops-coolify-cleanup-removes-init-images
title: "Coolify cleanup, init images and the deploy that cannot pull"
summary: "Stock Coolify cleanup removes every image not used by a container, including upstream images of finished init containers; a later deploy then pulls them after removing old containers, and a registry error takes the stack down."
category: operations
item_type: engineering_doc
tags: [coolify, cleanup, images, deploy, init-container, outage]
verified: read
verified_note: "rule 1 read from the Coolify 4.x source; rules 2-6 measured on 2026-09-28 (outage reconstructed from deploy logs) and 2026-10-03 (24 finished init containers after the prune filter was corrected); the deploy logs are not public (not re-run for this item)"
evidence:
  - "procedure: Coolify 4.x app/Actions/Server/CleanupDocker.php, buildImagePruneCommand — step 1 docker image prune -f, step 2 docker rmi of every image outside the application set"
  - "procedure: docker container prune with several label!= filters keeps a container only if it matches ALL of them (filters are ANDed) — check with docker container prune --dry-run style listing before trusting the exceptions"
  - "file: docker/minio/Dockerfile — example of building a third-party object-store image from a pinned source instead of pulling it from a registry"
valid_for: "Coolify 4.x; verify CleanupDocker on your version"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Before trusting that a deploy works offline because 'the image is local', check whether cleanup could have removed it. When diagnosing a deploy that failed after 'Removing old containers', look for a pull error of an init image first."
---
# Coolify cleanup, init images and the deploy that cannot pull

## Rules
1. **Step 2 of image cleanup deletes everything unused.** [read] `docker image prune -f` (dangling) is followed by `docker images` minus application images (`<uuid>_…`) and the current helper/realtime, then `docker rmi` on the rest. `rmi` succeeds for every image no container uses.
2. **Finished init containers used to vanish first.** [measured] Stock Coolify wrote its prune exceptions as several `label!=` filters on one `docker container prune`; Docker ANDs them, so they protected nothing. Finished init containers of applications were removed (one deploy's fresh container too; a workflow service was down 5 h). With the exceptions expressed correctly a finished init container keeps its image. Check how your version writes these filters.
3. **Order inside a deploy matters.** [measured] Coolify removes old containers before pulling. An init image deleted by cleanup is pulled at that moment; a 401 from the registry left no containers and the API returned 502.
4. **Own builds of third-party init images avoid the registry dependency.** [measured] The fix was building the object-store client image from source instead of pulling it from a third-party registry.
5. **`docker_images_to_keep` concerns only old tags.** [measured] Current = tags of all containers with label `coolify.applicationId`. Keep=1 does not delete the image of the running version's init container.
6. **Retention keeps one image per application, not a stack version.** [measured] After cleanup only one image of a multi-service stack remained. Local rollback of a stack is therefore not a full set; rollback = rebuild from git.

## Why
The outage looked like an infrastructure failure, but the cause was an interaction of three ordinary steps: cleanup, removal order, registry auth.
