---
slug: verify-identity-at-every-write
title: "Check who holds your name at every write, not only at start"
summary: "Where restarting agent sessions claim shared names, a name can be taken over between your check and your write; a declared author is not an authenticated one."
category: governance
item_type: playbook
tags: [identity, sessions, succession, logging]
verified: read
verified_note: "observed incident, not an experiment: on 2026-10-04 a takeover of a shared session name was logged and the previous holder wrote three more records under the same name within the next minute; recorded in a private log"
evidence:
  - "one observed incident (private log, 2026-10-04): takeover record, then three records by the previous holder under the taken name, then an open correction"
  - "procedure: compare the session id in the name's lock with your own immediately before each write; a mismatch means the name is no longer yours"
valid_for: "any multi-session setup where names are claimed by declaration"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "Before writing a record, commit or message under a shared name, check that the name's lock still holds your session id; if it does not, write under your own new identity and correct the record openly instead of rewriting it."
---
# Check who holds your name at every write

## Rules
1. **[read: observed incident] A name can change hands within seconds.** A check at start does not cover a write a minute later.
2. **[read] Verify the holder before each write** under a shared name (the lock contains your session id); better, let the tool verify it.
3. **[read] If you wrote under a name that was no longer yours, correct it openly** (who really wrote what, when); never rewrite the record.

## Why
Two sessions carried one name for about a minute: the new holder had taken it over, and the previous holder still logged a decision, a handover and a commit under it. The content was valid, the signature was not.
