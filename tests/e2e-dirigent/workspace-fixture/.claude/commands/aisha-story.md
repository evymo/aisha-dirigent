# AISHA Story Context

Manage the active story/project context.

## Arguments: $ARGUMENTS

## Instructions

1. **Read current context**: Read `.aisha/story.json` to get the active story ID and metadata.

2. **If `$ARGUMENTS` contains a UUID or ID**: Update `.aisha/story.json` with the new story ID:
   ```json
   {
     "story_id": "<provided-id>",
     "updated_at": "<current-iso-timestamp>"
   }
   ```
   This file is watched by the VS Code extension `aisha-dirigent` which will auto-sync.

3. **If no argument and story exists**:
   - Display current story ID and source
   - Consult MCP KB: Use `get_story_context` with the story ID to get delivery context
   - Show story details: status, priority, domain, tech_stack

4. **If no argument and no story**:
   - Inform the user that no story is set
   - Suggest setting one with `/aisha-story <uuid>`

5. **Context sharing**: The `.aisha/story.json` file is shared between:
   - Claude Code (this skill)
   - VS Code extension (`aisha-dirigent`)
   - Both tools read and write this file as a context bridge
