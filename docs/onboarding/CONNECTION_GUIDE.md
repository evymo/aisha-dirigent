# AISHA connection guide — two ways in

There are exactly **two** ways to use AISHA. Pick the one that matches what you
want, then follow that branch. Everything else (all secrets, all domains) the
stack generates or derives for itself — you only supply what's listed here.

```
                        ┌────────────────────────────────────────────┐
                        │  What do you want?                          │
                        └───────────────┬──────────────┬─────────────┘
                                        │              │
                 ┌──────────────────────▼───┐   ┌──────▼───────────────────────┐
                 │ A. RUN MY OWN AISHA       │   │ B. USE THE CENTRAL AISHA     │
                 │    (self-host / fork)     │   │    for my own project        │
                 │    → deploy a full stack  │   │    (the add-on as Dirigent)  │
                 └───────────────────────────┘   └──────────────────────────────┘
```

- **A — Self-host** if you want your OWN instance: your domains, your data, your
  users, running on your Coolify/servers. This deploys the whole stack.
- **B — Connect to central** if you just want AISHA to supervise *your own
  project* from your editor, without running any infrastructure. This points the
  IDE add-on at the hosted AISHA (`ask.aisha.guru`) with a personal token.

You can start with B today and move to A later — they are not exclusive.

---

## A. Self-host your own AISHA

**Who:** you want an independent instance (fork). **Result:** a full stack on
your Coolify, with your domains, KB, web content, and operator accounts.

### 1. Collect the inputs (guided)

The stack generates every secret and derives every domain itself. You supply
only the genuine per-instance decisions. The turnkey workbench prompts for
exactly what's missing and verifies locally:

```bash
node scripts/operator-setup.mjs          # prompts missing inputs → .env.local, then verifies
node scripts/operator-setup.mjs --check  # non-interactive: what's still missing (CI)
```

The full, always-current input list is generated from the schema:
[`config/fork-instance-inputs.env.example`](../../config/fork-instance-inputs.env.example).
The four groups:

| Group | You supply | Notes |
|-------|-----------|-------|
| **Infra endpoints** | Coolify + Forgejo base URLs + tokens, (optional) registry proxy | tokens are secrets |
| **Topology** | the 3 TLDs (`PUBLIC`/`INTERNAL`/`MESH`), namespace, admin email, profile | everything derives from these |
| **Instance identity** | private overlay repo URL, `operators.json` roster, (optional) `config/tenant.json` | see [instance-data-template](instance-data-template/README.md) |
| **BYOK** | LLM / mesh / email / observability keys | each is optional and gates one capability; the full annotated list is [`config/external-secrets.required.env`](../../config/external-secrets.required.env) |

### 2. Deploy

```bash
bash scripts/aisha-cold-start.sh         # derives everything else, provisions Coolify, deploys
```

### 3. Verify the live instance

```bash
npm run cold-start:verify                # read-only probe of the deployed instance
```

Your instance's identity (KB, web, Keycloak clients, operator roster) comes from
your **private** `aisha-instance-data` overlay — copy the skeleton at
[docs/onboarding/instance-data-template/](instance-data-template/README.md).

---

## B. Connect to the central AISHA (add-on as Dirigent)

**Who:** you want AISHA to supervise *your own project* from your editor, with no
infrastructure to run. **Result:** the IDE add-on talks to the hosted AISHA and
your editor can use AISHA as its model endpoint.

### 1. Get a personal access token (PAT)

PATs are **story-scoped** and **self-service** — no admin needed:

1. Sign in / register at the hosted AISHA web app (Keycloak SSO).
2. Pick (or create) the story your project belongs to.
3. Mint a PAT for that story:

   ```
   POST https://ask.aisha.guru/auth/v1/pats
   Authorization: Bearer <your-keycloak-access-token>
   Content-Type: application/json

   { "story_id": "<your-story-id>", "label": "my-editor" }
   ```

   The response contains a one-time raw token starting `mcp_…`. **Copy it now** —
   it is shown once.

### 2. Point your editor at it

Two axes, use either or both:

**Model endpoint** (use AISHA as the LLM your editor talks to):

```bash
ANTHROPIC_BASE_URL=https://ask.aisha.guru
ANTHROPIC_AUTH_TOKEN=mcp_…            # the PAT from step 1
```

**Governance add-on** (Dirigent supervising your project) — install the
`aisha-dirigent` add-on and set, in your editor's MCP/env config:

```bash
AISHA_URL=https://ask.aisha.guru
AISHA_PAT=mcp_…
```

Per-editor recipes (VS Code, Zed, Claude app, JetBrains) live in
[docs/integrations/AISHA_IDE_EXTENSION_CONTRACT.md](../integrations/AISHA_IDE_EXTENSION_CONTRACT.md).

### 3. Done

Your editor now uses the hosted AISHA. Nothing runs on your machine beyond the
add-on; the story scope keeps your project's data isolated.

---

## Which secrets do I ever provide?

Almost none. Cold-start auto-generates ~95% of env vars (all stack-internal
secrets, all derived domains). The only things a human supplies are in the table
above (self-host) or the single PAT (connect). The annotated source of truth for
every operator-supplied credential is
[`config/external-secrets.required.env`](../../config/external-secrets.required.env);
the non-secret per-instance decisions are in the generated
[`config/fork-instance-inputs.env.example`](../../config/fork-instance-inputs.env.example).
