---
slug: db-gate-protects-own-measurement
title: "A database gate must protect its own measurement"
summary: "A gate that inspects a database from inside that database can be deceived by the database: event triggers can rewrite the gate's helper functions or flip the measured objects during the gate's own transaction."
category: database_security
item_type: playbook
tags: [postgres, security-definer, event-trigger, gate, catalog]
verified: read
verified_note: "rules marked [measured] were measured by a probe kept in a private review repository, on PostgreSQL 18.6 and 16.15 in both trigger orders (not re-run for this item); rules 4 and 6 are reading"
evidence:
  - "file: scripts/db/check-definer-rpc-security.mjs — example of a gate that reads the catalog of the database it checks"
  - "procedure: re-measure rule 3 by creating an event trigger that, during the gate's transaction, switches a measured function from SECURITY DEFINER to INVOKER; the gate must report unmeasured (rule 1), not clean"
valid_for: "general"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When building or reviewing a check that runs SQL inside the inspected database (especially after replaying untrusted migrations), apply these rules and state plainly that it does not defend against an adversary with superuser rights."
---
# A database gate must protect its own measurement

## Rules
1. **Turn event triggers off for the gate's transaction** (`event_triggers = off`, PostgreSQL 17+, superuser). Where that is impossible and a live event trigger exists, the verdict is unmeasured with the list of triggers. [measured]
2. **A fingerprint of the gate's helper functions, checked after the gate's last DDL, catches rewriting** of body, settings, language and extra overloads. [measured]
3. **The fingerprint alone is not enough.** [measured] A trigger that leaves the helpers alone and switches the measured functions to non-definer inside the gate's transaction produced "clean" over a database with findings; rollback restored everything. Only rule 1 (or unmeasured) stops it.
4. **`SET LOCAL search_path = pg_catalog, pg_temp`** at the start: temporary relations must not shadow catalog tables. [read]
5. **One transaction ending in ROLLBACK; verify nothing changed.** [measured]
6. **Canaries inside the gate** prove each rule still detects its case. [read]
7. **Stale exceptions are an error.** [measured] An exception that matches nothing ended the run as a usage error, which also stopped a crude variant of the attack.

## Why
Measured on PostgreSQL 18.6 and 16.15, in both trigger orders: the full gate holds; with the trigger switch removed, the fingerprint layer alone reported clean.
