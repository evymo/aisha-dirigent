---
slug: ops-monitoring-alerts-need-delivery
title: "Monitoring that scales: portable rules, one evaluator per machine, logs without the docker socket"
summary: "Alert rules that load unchanged anywhere with thresholds as data, exactly one evaluator per machine, host logs collected without the docker socket, no permanently unhealthy containers, and machine monitoring kept apart from application monitoring."
category: operations
item_type: playbook
tags: [monitoring, prometheus, alerting, loki, grafana]
verified: read
verified_note: "rule 4 was measured in a fleet survey (2026-10-04); rules 1-2 were verified with promtool (4 of 4 rule mutations caught); rules 3 and 5 are reading (not re-run for this item)"
evidence:
  - "procedure: promtool test rules with cases below and above each threshold, pending and firing, and neighbours that must not fire"
  - "procedure: list containers with docker ps --filter health=unhealthy and read each healthcheck's last output before trusting an unhealthy alert"
valid_for: "general for Prometheus/Grafana/Loki"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When adding monitoring, keep alert rules portable with thresholds as recording rules and a promtool test per alert, evaluate each machine exactly once, collect host logs without the docker socket, and fix permanently unhealthy containers before alerting on health."
---
# Monitoring that scales

## Rules
1. **Rules portable, thresholds as data.** [read] Alert rules read nothing from the stack and can be loaded unchanged into a central Prometheus; thresholds are recording rules placed before the alerts; every alert has a promtool test (below and above threshold, pending and firing, neighbours that must not fire).
2. **One evaluator per machine.** [read] When two instances deploy the same observability compose on one machine, host alerts would arrive twice. Make host monitoring an optional capability behind a switch (default off), enabled for exactly one instance per machine; an invalid value disables it loudly (fail-closed).
3. **Host logs without the docker socket.** [read] The socket is root over the host and `:ro` does not limit the API. A collector can read `/var/log/journal` (with `/etc/machine-id`) and container json logs read-only, run with `cap_drop: ALL`, read-only root and no ports. Caveat: mounting `/var/lib/docker/containers` also exposes `config.v2.json` (container env = secrets) - a decision for the owner.
4. **A permanently unhealthy container is noise that hides real ones.** [measured] A survey found containers unhealthy for weeks while their service worked: a cache healthcheck `valkey-cli ping` without the password (`NOAUTH`, failing streak > 180 000 over two months) and mesh ingress health endpoints. Fix the check (authenticate via an env variable such as `REDISCLI_AUTH`) or the service; an alert on `unhealthy` is useless while known-false ones exist.
5. **Machine monitoring and application monitoring are different scopes.** [read] Machines go to one central stack; application metrics stay in each instance.
