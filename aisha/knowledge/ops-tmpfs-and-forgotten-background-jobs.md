---
slug: ops-tmpfs-and-forgotten-background-jobs
title: "/tmp is RAM on servers: forgotten background jobs take the host down"
summary: "A background command started over ssh without a time limit and writing to /tmp (tmpfs) grew for weeks and exhausted RAM and swap of a host running three instances; containers without init accumulated zombies."
category: operations
item_type: playbook
tags: [tmpfs, memory, oom, ssh, background-job, zombie, monitoring]
verified: read
verified_note: "growth and OOM kills were read from Prometheus (node_memory_Shmem_bytes, node_vmstat_oom_kill) and from the host during an outage on 2026-10-03; the host data is not public (not re-run for this item)"
evidence:
  - "procedure: df -h /tmp shows tmpfs; node_memory_Shmem_bytes and node_vmstat_oom_kill in Prometheus show the growth and the kill window without kernel log access"
  - "procedure: docker inspect -f '{{.HostConfig.Init}}' <container> = <nil> means no init process, so zombies pile up under PID 1"
valid_for: "any Linux host where /tmp is tmpfs; general"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Never start a background process on a server without a time limit (timeout, --until) and never write to /tmp there. When a host is short of memory, check df -h /tmp and Shmem before anything else."
---
# /tmp is RAM on servers: forgotten background jobs take the host down

## Rules
1. **Every background command over ssh needs an end.** [measured] `ssh host 'nohup docker events --since 1s … > /tmp/…log &'` without `--until` never ends and survives the disconnect. It wrote ~0.5 GB/day (mostly exec events of healthchecks) for 33 days.
2. **/tmp on servers is tmpfs = RAM.** [measured] The host ran 49 days without reboot, so nothing cleaned the file. RAM 46/47 GB, swap full, OOM killer 38 times since boot.
3. **Alert on memory classes, thresholds as data.** [read] Shmem > 2 GiB, MemAvailable < 10 %, tmpfs /tmp < 50 % free, swap > 80 % (each 5 min), any increase of `node_vmstat_oom_kill`. Thresholds are recording rules so they can change without editing alerts.
4. **Containers without init collect zombies.** [measured] ~39 000 zombie `bash` processes under one parent; zombies pile up under PID 1 of containers with `HostConfig.Init=nil`. Set `init: true` for long-running services that fork (healthcheck shells, workers).
5. **OOM kills are visible without kernel log access.** [measured] `node_vmstat_oom_kill` in Prometheus confirmed the kill window; an agent account does not read the kernel log and should not get that group.

## Why
A diagnostic command left running by one session took down the shared host weeks later. The process had no owner and the RAM disk had no watcher.
