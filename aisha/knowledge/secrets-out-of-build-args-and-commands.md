---
slug: secrets-out-of-build-args-and-commands
title: "Secrets stay out of build arguments and container commands"
summary: "Build arguments are recorded in image history and container commands are visible to anyone who can inspect the container; secrets reach containers at run time through the environment or files."
category: operations
item_type: playbook
tags: [secrets, docker-history, build-args, containers, hygiene]
verified: read
verified_note: "reading of Docker's image history and container inspection; not re-run for this item"
evidence:
  - "procedure: docker history --no-trunc <image> lists the build arguments a build received"
  - "procedure: docker inspect --format '{{json .Config.Cmd}}' <container> shows the command line as configured"
valid_for: "Docker and compose deployments; general"
scope: general
status: proposed
author: platform-maintainers
ai_instructions: "When writing Dockerfiles or compose services, never pass secrets as build arguments or literal command-line flags; deliver them at run time through the environment or mounted files, and inspect only the fields you need."
---
# Secrets stay out of build arguments and container commands

## Rules
1. **Secrets never go in as build args.** [read] Build arguments are recorded in image history (`docker history`), so anyone who can pull the image can read them. A build receives only the variables its Dockerfile declares, and secrets reach containers at run time. When printing history, show only the part after the last `/bin/sh -c`.
2. **Command and entrypoint are not safe either.** [measured] Service templates can put a password literally into the container command (for example `--requirepass`), so `docker inspect` of `Config.Cmd` prints it. Inspect only the fields you need, and treat `Cmd`, `Entrypoint` and `Args` like env values.
