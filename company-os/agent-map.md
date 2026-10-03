# Agent map — one-person-company fleet

> Auto-generated from AISHA Expert Overlay ruleset.
> Source: company-os/fleet.json (AISHA Company OS) — regenerate via `npm run gen:company-os`. Do not edit manually.
> Fleet fingerprint: `18c97d79adf5`

One human in the decision seat: **Evymo**. The fleet executes. Memory lives in
`company-os/brain/` — versioned files, not chat history.

| # | Command | Agent | Mission | Slot → model | Autonomy | Brain |
|---|---------|-------|---------|--------------|----------|-------|
| 01 | `/os-leads` | Leads Agent | leads → buyers | ember → sonnet | draft | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`weekly-brief.md` |
| 02 | `/os-research` | Research Agent | signals → patterns | verify → opus | advisory | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md` |
| 03 | `/os-docs` | Docs Agent | docs → memory | spark → haiku | draft | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`process-files.md` |
| 04 | `/os-ads` | Ads Agent | creative → campaigns | ember → sonnet | draft | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`style-rules.md` |
| 05 | `/os-content` | Content Agent | ideas → posts | ember → sonnet | draft | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`style-rules.md`<br>`wins-log.md` |
| 06 | `/os-sales` | Sales Agent | outreach → deals | ember → sonnet | draft | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`style-rules.md`<br>`wins-log.md` |
| 07 | `/os-product` | Product Agent | pain → roadmap | verify → opus | draft | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`process-files.md` |
| 08 | `/os-ops` | Ops Agent | tasks → systems | spark → haiku | draft | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`process-files.md`<br>`weekly-brief.md` |
| 09 | `/os-finance` | Finance Agent | revenue → decisions | verify → opus | advisory | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`wins-log.md` |
| 10 | `/os-review` | Review Agent | quality → ship/no-ship | verify → opus | advisory | `who-i-am.md`<br>`what-i-do.md`<br>`operating-context.md`<br>`review-prompt.md`<br>`style-rules.md` |

## Rituals

- `/os-weekly` — plan the week; updates `weekly-brief.md` after human confirm.
- `/os-ship` — the "anyone test" review gate. Nothing outward ships without it.

## Doctrine

A one-person company is not one person doing everything. It is one person
directing agents that never forget — and every outward action stays a human
decision.

<!-- aisha:user-section:start -->
<!--
  Anything between these markers is preserved across regenerations.
  Add agent-specific notes or constraints here.
-->
<!-- aisha:user-section:end -->
