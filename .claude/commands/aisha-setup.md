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

`.mcp.json` in the project root is committed and carries **no instance address and no token**.
You sign in **in the browser** (OAuth against the Keycloak of your instance); Claude Code keeps
and refreshes the tokens itself. This is the default record:

```json
{
  "mcpServers": {
    "aisha-knowledge": {
      "type": "http",
      "url": "${AISHA_MCP_URL}",
      "oauth": {
        "clientId": "aisha-mcp-client",
        "callbackPort": 59876
      }
    }
  }
}
```

- `url` — Claude Code expands `${AISHA_MCP_URL}` from its environment.
- `oauth.clientId` — the platform's public Keycloak client for MCP clients (declared in
  `keycloak/aisha-realm.json`, the same on every instance). Clients of the realm are
  declared, not registered on the fly, so the client is named here.
- `oauth.callbackPort` — the port of that client's registered return address
  (`http://localhost:59876/callback`). It must be free on your machine while you sign in.
  If another program holds it, Claude Code listens on a different port and Keycloak refuses
  the return address, so the sign-in fails — free the port and sign in again.

If the file is missing or the `aisha-knowledge` entry differs, regenerate it with
`npm run dirigent:bootstrap:mcp` — never write an address, a token, a client or a port into
the file by hand (the generator takes the client and the port from the realm declaration).

Check the variable in the environment Claude Code is started from. Report only whether it is
set; **never print its value**:

```bash
[ -n "${AISHA_MCP_URL:-}" ] && echo "OK: AISHA_MCP_URL is set" || echo "MISSING: AISHA_MCP_URL"
```

`AISHA_MCP_URL` is `<public API of your instance>/functions/v1/mcp-knowledge-server`
(for example `https://api.example.com/functions/v1/mcp-knowledge-server`). Use the address on
the public API host: the sign-in metadata of the endpoint is published for that address only.

**Sign in** (once; repeat when Claude Code says the server needs authentication):

1. Run `claude mcp login aisha-knowledge` in a shell, or `/mcp` inside Claude Code.
2. The browser opens the sign-in page of your instance. Sign in with your own account — the
   same one you use in the web application.
3. The browser returns to `http://localhost:59876/callback` and Claude Code stores the tokens.

On a machine without a browser (SSH), run `claude mcp login aisha-knowledge --no-browser`,
open the printed address on your own machine and paste the address the browser ends on back
into the prompt.

You reach the tools your account is allowed to use — the same identity and roles as in the
web application. Nothing is granted by the client itself.

The sign-in lasts as long as the session in the realm of your instance: after 30 minutes
without use the session expires and you sign in again. That is a setting of the realm
(session idle time), not a fault of Claude Code.

Test MCP connectivity by calling `search_knowledge` with query `"health check"`.

If it does not work:

- `claude mcp list` shows a missing-variable warning for the server → `AISHA_MCP_URL` is not
  set in the environment Claude Code was started from.
- Claude Code reports a client registration error (it tried to register itself as a new
  client) → the `oauth` block is missing from the record; regenerate the file.
- Keycloak rejects the client or the return address → the realm of your instance does not
  have the client `aisha-mcp-client` yet, or the port in the file differs from the realm
  declaration. Regenerate the file; a missing client is for the operator of the instance.
- Signed in, but every call answers 403 → the knowledge server of your instance does not
  accept this client (`KC_ALLOWED_CLIENTS`), or your account may not use that tool.

Report: Connected / Needs sign-in / Missing variable / Rejected (403) / Unreachable

#### Machines without a person (n8n, CI) — static token

A machine cannot sign in in a browser. It uses a personal `mcp_…` access token **with a tool
allowlist** and keeps its **own** record with an `Authorization` header — never in the
committed `.mcp.json`:

```json
{
  "mcpServers": {
    "aisha-knowledge": {
      "type": "http",
      "url": "${AISHA_MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${AISHA_TOKEN}"
      }
    }
  }
}
```

For Claude Code on that machine, add the record at local scope; it takes precedence over the
project record of the same name and the shell fills in both values:

```bash
claude mcp add --transport http aisha-knowledge "$AISHA_MCP_URL" --header "Authorization: Bearer $AISHA_TOKEN"
```

n8n uses the same address and the same header in its own MCP client credential.

To get a token, sign in with Keycloak and call the self-service route with your access token:

```
POST <public API of your instance>/auth/v1/pats
Authorization: Bearer <your Keycloak access token>
{ "story_id": "<story uuid>", "allowed_tools": ["search_knowledge_v2", "search_knowledge", "get_expert_rule", "get_knowledge_item"] }
```

The token is shown once. It reaches only the tools listed in `allowed_tools`, and only tools
available to a signed-in user — admin tools stay out of reach even when listed. A response
carrying `mcp_warning` means the token was minted without an allowlist and will not work here.
The anon key is not accepted by the MCP endpoint (401), and an `mcp_` token without
`allowed_tools` is rejected with 403.

With an `Authorization` header configured, Claude Code does not offer the browser sign-in: a
401 or 403 is reported as a failed connection. If `AISHA_TOKEN` is set and the server still
answers 401, check that Claude Code expanded it: run `claude --debug-file <file>` and search
the file for `never expanded toward a remote server`.

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
MCP Server       [OK/NEEDS SIGN-IN/MISSING/UNREACHABLE]
Environment      [OK/MISSING]
Story Context    [set/none]
Skills           [10 available]
========================
```

If everything is OK: "Setup complete. Start with `/aisha-health` for a full system check."
If something is missing: Guide the user through fixing it step by step.
