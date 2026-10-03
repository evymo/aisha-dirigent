# Ship gate — the "anyone test" before anything leaves the company

> Auto-generated from AISHA Expert Overlay ruleset.
> Source: company-os/fleet.json (AISHA Company OS) — regenerate via `npm run gen:company-os`. Do not edit manually.
> Fleet fingerprint: `18c97d79adf5`

Run the fleet's review agent (`os-review`) on an artifact before
the human ships it. **The human decides. The agents execute.**

## Arguments: $ARGUMENTS

## Instructions

1. Resolve the artifact from `$ARGUMENTS`: a file path, a pasted draft, or —
   when empty — the most recent outward-facing artifact produced in this
   conversation. If nothing is identifiable, ask.
2. Spawn the `os-review` subagent with the artifact and its
   destination channel/context.
3. Report the verdict verbatim: `SHIP` or `FIX FIRST` + numbered issues.
4. On `FIX FIRST`: offer to route the issues back to the producing agent
   (e.g. `/os-content`) — never silently fix and re-ship in one step.
5. On `SHIP`: hand back to the human for the actual send/publish. Never
   perform the outward action yourself.

<!-- aisha:user-section:start -->
<!--
  Anything between these markers is preserved across regenerations.
  Add agent-specific notes or constraints here.
-->
<!-- aisha:user-section:end -->
