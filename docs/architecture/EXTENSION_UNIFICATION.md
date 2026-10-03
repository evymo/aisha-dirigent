# Extension Unification — one manifest, one registry, one resolver

> **Status:** review + recommendation (grounded against live code at `main`, file:line-verified). No code changed by this document.
> **Scope:** OSS core, instance-agnostic. The convergence below must hold for any instance, not just aisha.guru.
> **Companion:** the cross-surface matrix is also rendered as a shareable visual (Artifact "AISHA Extension Unification Review").

## Why this exists

The stack can be extended **eight** ways. Only the agent marketplace carries a declared
capability **all the way into the runtime resolver**. Every other surface either stops at a
registry the resolver never reads, or has its own manifest format and drift-prone copies. For
a stack whose whole premise is *"AISHA routes work by capability availability"*, an extension
that the resolver cannot see is an extension the orchestration cannot use.

This is a wire-up problem, not a redesign. The correct spine already exists and is
gate-enforced — it is simply only traversed by one surface today.

## The eight surfaces

| Surface | Manifest / contract | Registration path | Reaches resolver? | Instance-bound? | State |
|---|---|---|---|---|---|
| **Plugin** (`services/svc-plugin-system`) | `schemas/plugin-manifest.schema.json` (capability URIs) | `submit_plugin` → `plugin_catalog` → state machine | only via `agent` kind | clean | 2 of 6 kinds wired |
| **Skill** (4 SoTs) | YAML frontmatter `SKILL.md` | gen:ide · repo tree · n8n factory · `aisha_scaffold` | no | n8n factory pins a model id | 4 divergent planes |
| **n8n node** (`packages/n8n-nodes-aisha`) | npm `"n8n"` block | package convention · `custom_node_registry` | workflow-as-executor only | `n8n.aisha.guru` default | dup with dead kind |
| **MCP server** (`mcp_server_registry`) | in-file TS Sets · admin RPC | register → test → enable | **yes** — paired `ai_provider_registry` row | `.mcp.json` root bind | full loop |
| **Editor ext** (`extensions/*`) | VS Code `contributes` | build · install · ide-bridge WS push | no | TLD-derived (good) | server ≠ repo adapters |
| **LLM provider** (`backendRegistry`) | env factory · `ai_provider_registry` | env key + DB row | **yes** — capability flags | `scoped_to_instance_id` | wired; `backend_provider` kind dead |
| **DB RPC** (`aisha/db/sql`) | SoT file + migration | PostgREST schema is the registry | indirect | clean | stable layer |
| **Marketplace** (`kind=agent`) | `agent_spec` in plugin manifest | `materialize_agent_runtime` → `agent_catalog` | **yes — end to end** | per-story isolation | the reference |

**Six plugin kinds** (`aisha/db/sql/enums/plugin_kind.sql`): `web_tracking`, `auth_provider`,
`backend_provider`, `automation_node`, `full_stack`, `agent`. Only `full_stack` and `agent`
are wired; the other four have a type contract but **no loader** anywhere.

## The spine that already exists

One path is correct end to end. An approved **agent** manifest becomes a registry row in the
same transaction, and the row's declared capabilities are what the resolver reads:

```
manifest capabilities[]        materialize_agent_runtime         derive_clow_needs
(plugin-manifest.schema.json)  → agent_catalog (declared caps)  → fn_admit_clow
  ^[a-z]+\..+$ URIs               (in the approval txn)          → aisha_resolve_clow_backend
      DECLARES                        MATERIALIZES                    RESOLVES
```

Nothing here is agent-specific. The doctrine is already locked by two gates —
`admission-composes-registries.gate.test.ts` (verdicts derive from registries + policy, the
allow-list shape is banned) and `runtime-availability-no-allowlist.gate.test.ts`. The task is
to make **every** approved manifest yield a resolver-visible row, not to invent a mechanism.

## The convergence — six moves, dependency-ordered

Each move reuses an existing mechanism; none adds a subsystem (the universal-lens rule). The
through-line: promote the plugin manifest as the **single** extension contract (it already
covers all 6 kinds) and make *"approved manifest ⇒ registry row ⇒ capability-availability
resolution"* an invariant asserted by extending the admission gate.

1. **Enforce the inventory that already spans everything** *(reuse · XS)* —
   `docs/catalog/capabilities.json` already inventories all surfaces, but its drift check
   `gen:catalog:check` is wired into neither CI nor husky. Add it beside the gen:ide drift
   gate. Zero new code.

2. **Widen the catalog scanners to the missed SoTs** *(reuse · S)* — `scanAgentSkills`
   (`scripts/lib/capability-catalog.mjs`) sees only `.claude/skills`; extend it to
   `codex/skills/` and the Claude-app skills, and add a scanner for the n8n `"n8n"` package
   block. The catalog stops under-reporting coverage.

3. **One materializer per kind, copied from the agent pattern** *(M)* —
   `materialize_agent_runtime.sql` is the template. Add `materialize_backend_provider` →
   `ai_provider_registry` (kind=`backend_provider` manifests carry endpoint / auth_env_var /
   capability flags) and `materialize_automation_node` → `custom_node_registry` (collapsing
   the NodeFactory duplication), called from the same approval gates
   (`fn_aisha_kb_decision` / `review_moderation_item`) exactly as the agent branch does.
   Revives the two dead kinds without a new subsystem.

4. **Register the plugin sandbox as a runtime** *(M)* — give svc-plugin-system's executor an
   `ai_runtime_registry` row (kind e.g. `plugin_sandbox`, declared caps from the manifest
   sandbox policy) so `fn_resolve_runtime` / `derive_clow_needs` can route capability-needing
   work to sandboxed plugins the same way it routes to openclaw / hermes / cli / workflow.

5. **Retire the divergent copies** *(reuse · S)* — delete the
   `packages/n8n-nodes-aisha/workflows/` subset in favour of `n8n/workflows/` (the sync tool's
   SoT); align `svc-ide-context`'s IDE enum (`instructions.ts`) with the 12 repo-side adapters
   (`scripts/ide-adapters/registry.mjs`) from one shared list.

6. **Make the doc tell the truth** *(reuse · XS)* — `docs/PLUGIN_SYSTEM.md` still describes a
   Deno edge function and `supabase/functions/…` / `supabase/migrations/…` paths that do not
   exist, and "5 kinds" when there are 6. Rewrite to the svc-plugin-system / svc-agent-runner /
   `aisha/db/sql` reality and note which kinds now materialize.

**Net effect:** no new manifest format, no new runtime. The admission gate grows one assertion
— *every kind has a materializer* — and the whole surface converges on the spine agents
already prove.

## Instance-agnosticism

Overall good — endpoints are settings/env-derived. The residual instance leaks to parameterize
(the only things standing between "OSS clone" and "instance-neutral extension surface"):

- `.mcp.json` (root, committed) hard-binds `https://api.backend.id3a.cz/functions/v1/mcp-knowledge-server` — regenerate it via `dirigent:bootstrap:mcp` as the only source; keep only localhost/example in the committed file.
- `AishaNodeFactory.node.ts` defaults `$env.N8N_URL || "https://n8n.aisha.guru"`.
- `.aisha/dirigent.template.json` carries `"aishaUrl": "https://api.aisha.guru"` as a profile default.

None is load-bearing for the OSS core; each should resolve from instance config at bootstrap.
