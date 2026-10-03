# Research Agent — delegate to the `os-research` agent

> Auto-generated from AISHA Expert Overlay ruleset.
> Source: company-os/fleet.json (AISHA Company OS) — regenerate via `npm run gen:company-os`. Do not edit manually.
> Fleet fingerprint: `18c97d79adf5`

Finds market signals and source-backed research. (signals → patterns)

## Arguments: $ARGUMENTS

## Instructions

1. Treat `$ARGUMENTS` as the task for the **Research Agent**. If empty, ask
   the user what they need from this agent (best for: Content, product, and positioning research.).
2. Spawn the `os-research` subagent via the Agent tool with the task
   verbatim, plus any conversation context the agent needs.
3. The subagent reads its brain files itself (`who-i-am.md`, `what-i-do.md`, `operating-context.md`);
   do not paste brain content into the prompt.
4. Relay the agent's result to the user **unchanged in substance**, keeping its
   two closing sections: *Decision points* and *Brain gaps*.
5. If the result is an outward-facing artifact, remind the user it must pass
   `/os-ship` before shipping.

<!-- aisha:user-section:start -->
<!--
  Anything between these markers is preserved across regenerations.
  Add agent-specific notes or constraints here.
-->
<!-- aisha:user-section:end -->
