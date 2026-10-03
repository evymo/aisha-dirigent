---
description: Scan generated IDE instruction files (CLAUDE.md, .cursorrules, copilot-instructions.md, …) for user-section customizations and queue them as rule proposals for the AISHA Dirigent knowledge base. Read-only by default — nothing leaves the machine until you explicitly submit.
---

# /aisha-propose-rule — turn local customizations into rule proposals

Helps the developer **teach Dirigent** from edits they made inside the
`<!-- aisha:user-section:start --> … <!-- aisha:user-section:end -->`
blocks of regenerated IDE instruction files. Aligns with the advisory-only
principle: Dirigent never reads these edits silently; the developer makes
the explicit submit decision.

## What you do, step by step

### 1. List customizations (read-only)

```bash
node scripts/dirigent-collect-local-customizations.mjs --print
```

Output is a list of `(path, sha, content)` triples — exactly what would be
queued. **Nothing is written and nothing is sent.** Confirm with the user
that the content is non-sensitive (no API keys, tokens, internal hostnames)
before continuing.

### 2. Queue them locally

```bash
node scripts/dirigent-collect-local-customizations.mjs
```

This populates `.aisha/local-rule-proposals.json` (git-ignored) with
deduplicated entries. Idempotent — running it twice produces the same queue.

### 3. Help the user rewrite each entry as a rule

For every queued proposal, walk through with the user:

- What category does it fit? (`coding_standard`, `security_practice`,
  `architecture_pattern`, …)
- Is this universal for the project, or context-specific (story / domain)?
- Is the text Czech or English? (Both are accepted upstream.)
- Suggest a slug (`kebab-case`).

Update the proposal entry in `.aisha/local-rule-proposals.json` with the
finalized `title`, `category`, `slug`, and `language`. Keep the original
`content` unchanged so it can be audited.

### 4. Submit upstream (when ready)

```bash
node scripts/dirigent-collect-local-customizations.mjs --submit
```

Currently this is a stub — it tells the developer the MCP endpoint
(`mcp_propose_rule_from_local_edit`) is not yet shipped. Until then, the
queue sits locally; once the endpoint lands, this command will POST each
entry to the Dirigent backend and remove successfully-submitted entries
from the queue.

## When to suggest this command

- After the developer says "I keep adding the same note to CLAUDE.md",
  "Claude keeps ignoring my override", or "this rule should be canonical".
- After `npm run gen:ide` regenerates with a `(user-section preserved)`
  marker on a file you don't recognize — that means the developer wrote
  something the rule registry doesn't know about.

## Safety rails

- **Never** read `.aisha/local-rule-proposals.json` and act on its content
  without the developer's review. The queue is their drafting space.
- **Never** submit without explicit confirmation.
- The user-section block markers are the only source of truth — text
  outside them is regenerated and must not be treated as a proposal.

## Related

- Script: `scripts/dirigent-collect-local-customizations.mjs`
- Safety utilities: `scripts/lib/ide-instructions-safety.mjs`,
  `extensions/aisha-dirigent/src/generators/file-safety.ts`
- Gate test: `src/tests/gates/ide-instructions-safety.gate.test.ts`
- Memory: `project_dirigent_supervision_overlay.md`
  (Phase A+B golden principle — advisory-only)
