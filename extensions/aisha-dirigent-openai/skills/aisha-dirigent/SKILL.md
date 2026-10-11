---
name: aisha-dirigent
description: Use AISHA to find assigned project steps, load a selected story and expert guidance, prepare IDE instructions, or record an authorized progress handoff. Applies to AISHA project work in Codex and ChatGPT.
---

Use the connected AISHA MCP server under the user's own AISHA ID. If linking fails, surface the connection error and use the host's OAuth login. Never request passwords or tokens in chat or substitute an administrator/service credential.

Call `my_next_steps` for the user's assigned work. Establish the target story from the user's request and accessible results; ask if multiple projects match. Do not borrow story IDs from another account or a previous workspace. Read `get_story_context` for that story and `search_knowledge` for relevant expert guidance. Cite the returned sources and distinguish empty results from connection errors.

For local IDE preparation, call `generate_copilot_instructions` for the selected story. Inspect existing workspace instructions before applying changes and preserve local rules and edits. In an online session, return the proposed instructions as an artifact; do not claim to have changed a development machine.

For a requested handoff, summarize changes, validation and remaining blockers. Use `report_progress` only for the authorized selected story. Report whether the backend accepted the entry. A successful read does not prove that progress writes, project creation or automation execution work.

For automation requests, inspect the available tools and current automation configuration. Check existing approval requirements and project scope before a trigger or configuration change. Do not infer authorization to activate every automation from a request to inspect it. Keep access control in AISHA; do not grant roles or bypass project membership to make a workflow pass.
