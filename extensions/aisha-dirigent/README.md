# AISHA Dirigent — Autonomous Development Orchestrator for VS Code

Proactive AI development orchestrator that watches your workspace and autonomously guides development decisions, code quality, compliance, and testing. Connects to MCP Knowledge Server and n8n agent workflows.

Two modes in one extension: **autonomous Dirigent Brief** (triggered on file save) and **manual `@aisha` chat** (on demand).

Works with **any project** — connect to your own backend or use the hosted AISHA Cloud platform.

## Interaction Modes

### Autonomous Mode — Dirigent Brief System

When you save a file, the extension analyzes your workspace state and sends a structured **Dirigent Brief** to the default Copilot agent (regular chat, not `@aisha`). This enables the agent to actually fix code, not just advise.

The brief includes:
- **Errors** — active TypeScript/ESLint diagnostics for that file
- **Development State** — file role, missing tests, migration status
- **Workflow Directives** — prioritized next steps (test-first: missing test is always step 1)
- **KB Rules** — relevant architecture rules from the knowledge base for that file role
- **Story Context** — active project, ruleset, and compliance requirements

**File roles detected**: `hook`, `component`, `schema`, `migration`, `i18n`, `test`, `page`

On first brief per session you get a notification with three options:
- **Send to Chat** — open brief in Copilot chat once
- **Always send** — auto-approve for the rest of the session
- **Dismiss** — skip this brief

### Manual Mode — `@aisha` Chat Participant

Ask questions, request code reviews, or trigger agent workflows on demand via VS Code Chat:

```
@aisha /test src/hooks/useMyHook.ts
@aisha /compliance check this migration
@aisha /onboard
@aisha what story am I working on?
```

**Slash commands:**

| Command | Description |
|---------|-------------|
| `/test` | Generate or review tests for the active file |
| `/quality` | Code quality and architecture review |
| `/compliance` | Check against KB rules and security patterns |
| `/estimate` | Effort estimate for a task or story |
| `/next` | Suggest next development step |
| `/health` | Platform health and agent status |
| `/route` | Route task to a specific model (n8n, MCP fallback) |
| `/models` | Browse AI model registry and usage stats |
| `/eval` | Evaluate agent output or story delivery |
| `/proposals` | List open proposals for the active story |
| `/instructions` | Sync `copilot-instructions.md` from KB |
| `/dirigent` | Direct Dirigent orchestration prompt |
| `/onboard` | Full autonomous project onboarding pipeline |
| `/story` | Query or manage the active story context |
| `/local` | Chat using a local LLM (edge-first mode) |
| `/connect-repo` | Connect workspace to a GitHub repository |

## Getting Started

1. Install the extension from a `.vsix` file
2. Run **AISHA Dirigent: Connect (Setup Wizard)** from the Command Palette
   - Step 1: Select backend profile (`local` / `cloud` / custom)
   - Step 2: Authenticate (skipped for local dev)
   - Step 3: Select or enter your active story
   - Step 4: Auto-sync `copilot-instructions.md` from KB
3. Save any file to receive your first Dirigent Brief
4. Or start manually with `@aisha` in VS Code Chat

### Configuration

All settings are under `aisha.dirigent.*` (VS Code settings or `.aisha/dirigent.json`):

| Setting | Description |
|---------|-------------|
| `aisha.dirigent.mcpUrl` | MCP Knowledge Server URL |
| `aisha.dirigent.supabaseUrl` | AISHA API / Gateway URL (PostgREST style) for auth, push channel, context sync and RPC calls. Uses the current stack (local warmup or self-hosted), not legacy Supabase. |
| `aisha.dirigent.anonKey` | Public anon key for the gateway (from local-warmup or prod .env) |
| `aisha.dirigent.n8nTriggerUrl` | n8n trigger URL for agent orchestration |
| `aisha.dirigent.storyId` | Default story UUID (overridden by `.aisha/story.json`) |
| `aisha.dirigent.expertiseLevel` | Guidance profile — controls depth of decision support: `beginner` (Educating) / `intermediate` (Collaborative) / `advanced` (Autonomous) / `expert` (Supervisory) |

MCP, n8n, RPC, push, and context sync calls use the signed-in AISHA ID / Keycloak access token. Static MCP or service-role tokens are not supported by the extension.

**Config resolution order** (highest priority first):
1. `AISHA_*` environment variables
2. `.aisha/dirigent.local.json` (gitignored, per-machine overrides)
3. `.aisha/dirigent.json` (committed workspace config)
4. VS Code settings fallback

### Connection Profiles

Named backend profiles in `.aisha/dirigent.json` let you switch environments:

```json
{
  "profiles": {
    "local": { "supabaseUrl": "http://127.0.0.1:8000", "mcpUrl": "..." },   // from `npm run warmup:local` (gateway)
    "selfhosted": { "supabaseUrl": "https://api.yourdomain.com", "mcpUrl": "..." }
  },
  "activeProfile": "local"
}
```

Switch with **AISHA Dirigent: Switch Backend** or edit `activeProfile` directly.

## Commands

| Command | Description |
|---------|-------------|
| AISHA Dirigent: Connect (Setup Wizard) | 4-step wizard: profile → auth → story → sync |
| AISHA Dirigent: Login | Authenticate with your account |
| AISHA Dirigent: Logout | Sign out |
| AISHA Dirigent: Create Account (Signup) | Register a new account |
| AISHA Dirigent: Switch Backend | Toggle between configured backend profiles |
| AISHA Dirigent: Set Active Story | Set project context |
| AISHA Dirigent: Set Guidance Profile | Adjust guidance depth and decision support level |
| AISHA Dirigent: Sync Copilot Instructions | Generate `copilot-instructions.md` from KB |
| AISHA Dirigent: Refresh AI Models | Reload model registry |
| AISHA Dirigent: Clear Active Session | Reset session state |

## Architecture

```
VS Code workspace
├── Dirigent Brief (auto-flow.ts)          ← file save triggers state assessment
│   ├── detectFileRole()                   ← hook / schema / migration / component…
│   ├── assessDevState()                   ← errors, missing tests, story context
│   ├── buildDirigentBrief()               ← structured prompt with directives + KB rules
│   └── sendBriefToChat()                  ← to DEFAULT Copilot agent (not @aisha)
│
├── @aisha Chat Participant (participant.ts) ← manual mode, slash commands
│   └── routes to MCP + n8n workflows
│
├── AISHA Push ←── SSE ←── backend        ← real-time story/decision events
├── Session Manager                        ← story context, decision log, run_id
└── Status Bar                             ← backend, session, expertise
        │
        ├── MCP Knowledge Server (JSON-RPC 2.0 / svc-mcp-knowledge)
        │       └── search_knowledge, get_expert_rule, validate_compliance…
        │
        └── n8n Orchestration
                └── Knowledge, Compliance, Delivery, Dirigent, Ragnarok agents
```

**Key distinction**: Dirigent Briefs go to **regular Copilot chat** (agent can edit code directly). Manual `@aisha` requests go through the **chat participant** (advisory, tool calls, structured responses).

## Development

```bash
cd extensions/aisha-dirigent
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

### Build `.vsix`

```bash
npx @vscode/vsce package --no-dependencies
```

## License

Source code is licensed under the **[Elastic License 2.0](LICENSE.md)** (ELv2).
Copyright © 2026 Evymo s.r.o. and AISHA Platform contributors.

You may use, copy, modify, and deploy this extension (including for your clients).
You may **not** offer it to third parties as a hosted or managed service, remove
the licensing/copyright notices, or circumvent any license-key functionality.

The hosted **AISHA** service (internal models, evaluation and routing) is a
separate proprietary service operated by Evymo s.r.o. and is **not** part of, nor
licensed under, ELv2. "AISHA", "Evymo" and "Dirigent" are trade names of
Evymo s.r.o.; no trademark rights are granted by the source license.
