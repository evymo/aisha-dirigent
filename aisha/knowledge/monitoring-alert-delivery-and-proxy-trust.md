---
slug: monitoring-alert-delivery-and-proxy-trust
title: "An alert counts only when a rule fires it and a human receives it; dashboards trust their proxy only"
summary: "Metrics without loaded rules warn nobody, an alert without a delivered channel equals no alert, and a dashboard behind an auth proxy accepts the user header only from that proxy."
category: operations
item_type: playbook
tags: [monitoring, prometheus, alerting, grafana, security]
verified: read
verified_note: "rules 1 and 3 were measured on hosts (2026-10-03); rules 2 and 4 are reading (not re-run for this item)"
evidence:
  - "procedure: promtool check config — a Prometheus configuration without rule_files evaluates no alert"
  - "procedure: fire a test alert and confirm that a human receives it through every configured contact point"
  - "reading: the dashboard's authentication proxy settings (trusted source of the user header, user creation)"
valid_for: "general for Prometheus/Grafana"
scope: general
status: proposed
author: platform-maintainers
ai_instructions: "When adding or reviewing monitoring, check that rules are loaded, that an alert reaches a human (test it end to end), and that nobody on the internal network can impersonate a dashboard user. Give agents dashboard and log access only through an authentication proxy whose user header is trusted from that proxy alone."
---
# An alert counts only when a rule fires it and a human receives it

## Rules
1. **Metrics without rules warn nobody.** [measured] Prometheus recorded the memory growth that later took down a host, but no rule evaluated it and no alert was delivered.
2. **Delivery is part of the alert.** [read] A contact point whose webhook and SMTP are never delivered is silent. Test delivery end to end before calling monitoring done.
3. **The growth was visible, nobody was warned.** [measured] `node_memory_Shmem_bytes` grew from 7.4 to 13.9 GB over 2.5 weeks before the host ran out of memory. An alert without a delivery channel is equal to no alert.
4. **Proxy authentication needs a trust boundary.** [read] A dashboard behind an auth proxy accepts the user header only from that proxy (allowlist or a signed token) and never creates users from an unverified header; agents reach dashboards and logs only through such a proxy.
