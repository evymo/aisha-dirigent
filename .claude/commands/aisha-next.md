# AISHA Next Step

Pick the next piece of work from AISHA and report back when it is done. Your work comes from the
workflow engine, not from guessing: every tool below runs under YOUR identity (the MCP login of
this IDE) and only shows or changes what you are allowed to.

## Arguments: $ARGUMENTS

## Instructions

1. **Pull your work** — call the MCP tool `my_next_steps` (server `aisha-knowledge`).
   - Default: open steps of the last 30 days. Pass `status` / `days` / `include_closed` only when
     `$ARGUMENTS` asks for it.
   - If the tool returns `error: "unauthenticated"` or the server needs a login, tell the user to
     run `/mcp` and log in to `aisha-knowledge`. Do not work around the login.

2. **Load the story** — read `.aisha/story.json` for the active story id. Call `get_story_context`
   with that `story_id` (the stack default story works too). Use its entries as the context of
   the step: decisions, blockers, what others already reported.

3. **Choose one step** and say which one and why (assigned to you, oldest, blocks others). If
   `my_next_steps` is empty, say so and suggest asking the story owner for work — do not invent
   a task.

4. **Do the step** in this repository the usual way (branch, tests, gates).

5. **Report back** — both, in this order:
   - `report_progress` with a short `content` of what was done (`kind: "status_update"`), or
     `kind: "blocker"` when you are stuck, `"milestone"` when a deliverable is done,
     `"architecture_decision"` for a decision others must know. It writes into the story from
     `.aisha/story.json` (pass `story_id`) or the story bound to your token.
   - `complete_step` with the `step_id`, a one-line `notes` and, if useful, `output_data`
     (e.g. `{ "branch": "...", "commit": "..." }`). Use `has_deviation: true` when the step was
     done differently than planned and say how in `notes`.
   Read the result: `complete_step` returns `{ ok, error? }`; `ok: false` means the step is not
   yours or not open — report that to the user instead of retrying.

6. **Errors** come as `{ error: <code>, incident }` (`forbidden`, `not_found`, `invalid_input`,
   `unauthenticated`, `failed`). Give the user the code and the incident id; the details are in the
   service log under that incident.
