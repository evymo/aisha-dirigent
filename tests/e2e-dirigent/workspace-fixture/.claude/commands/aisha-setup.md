# AISHA Claude Code Setup

Interactive onboarding for new developers. Run this after `git clone` + `npm install`.

## Instructions

Perform the following checks and guide the user through any missing setup:

### 1. Prerequisites

Check and report status:

```bash
node --version    # Needs v18+
npm --version     # Needs v9+
git --version
```

### 2. Dependencies

```bash
ls node_modules/.package-lock.json 2>/dev/null && echo "OK: node_modules exists" || echo "MISSING: Run npm install"
```

### 3. MCP Knowledge Server

Check if `.mcp.json` exists in project root. If missing, create it:

```json
{
  "mcpServers": {
    "aisha-knowledge": {
      "type": "http",
      "url": "https://api.aisha.guru/functions/v1/mcp-knowledge-server",
      "headers": {
        "Authorization": "Bearer <VITE_AISHA_POSTGREST_ANON_KEY from .env>"
      }
    }
  }
}
```

Test MCP connectivity by calling `search_knowledge` with query `"health check"`.

Report: Connected / Unreachable / Missing config

### 4. Environment

```bash
test -f .env && echo "OK: .env exists" || echo "MISSING: Copy .env.aisha.example to .env and fill in values"
```

If `.env` exists, check for critical vars:
- `VITE_AISHA_POSTGREST_URL`
- `VITE_AISHA_POSTGREST_ANON_KEY`

### 5. Story Context

```bash
cat .aisha/story.json 2>/dev/null
```

If no story is set, ask the user if they want to set one.

### 6. Available Skills

List all available `/aisha-*` commands:

| Command | Purpose |
|---------|---------|
| `/aisha-test` | Run tests for changed files |
| `/aisha-quality` | Code quality audit |
| `/aisha-compliance` | PR compliance gate |
| `/aisha-estimate` | Effort estimation |
| `/aisha-next` | Suggest next step |
| `/aisha-deploy` | Deployment workflow |
| `/aisha-db` | Database operations |
| `/aisha-story` | Story context management |
| `/aisha-health` | System health check |
| `/aisha-setup` | This onboarding (re-run anytime) |

### 7. Summary

Present a dashboard:

```
AISHA Claude Code Setup
========================
Node.js          [OK/MISSING]
Dependencies     [OK/MISSING]
MCP Server       [OK/MISSING/UNREACHABLE]
Environment      [OK/MISSING]
Story Context    [set/none]
Skills           [10 available]
========================
```

If everything is OK: "Setup complete. Start with `/aisha-health` for a full system check."
If something is missing: Guide the user through fixing it step by step.
