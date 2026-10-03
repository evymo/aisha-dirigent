# AISHA Company OS — customizable agent fleet

> Status: v1 (local-first layer). Owner: AISHA Dirigent.
> Czech TL;DR: Customizovatelná vrstva "one-person company OS" nad AISHA stackem —
> jeden člověk rozhoduje, flotila specializovaných agentů vykonává. Definuje se
> deklarativně v `company-os/fleet.json` + markdown "brain" souborech a generuje
> se do `.claude/agents` + `.claude/commands` stejným mechanismem jako Dirigent
> overlay. Pole manifestu zrcadlí `plugin_catalog.agent_spec`, takže lokální
> agent má přímou růstovou cestu do marketplace (`publish_agent`) a n8n runtime.

## 1. Motivation

The "One-Person Company OS" pattern: one human in the decision seat, a fleet of
specialized agents running the execution layer, and a small set of versioned
markdown files that make the agents useful (voice, offers, context, process
files, weekly goals). The human decides; the agents execute — and never forget,
because the memory lives in files, not in chat history.

AISHA already has every substrate this needs — declarative marketplace agents
(`plugin_catalog.agent_spec`), a runtime catalog (`agent_catalog`), n8n
personal/workflow agents, and a `.claude/` artifact generation pipeline
(`scripts/ide-adapters/`). What was missing is the **local-first, customizable
entry point**: a way for an operator to define *their* fleet and *their*
business brain in the repo, generate working Claude Code agents from it in
seconds, and only later — optionally — promote agents into the platform.

## 2. Concept mapping (design → AISHA)

| One-Person Company OS concept | AISHA construct |
|---|---|
| Claude Project "Business Brain" | `company-os/brain/*.md` (versioned markdown, single source of truth) |
| 10 specialized MCP agents | `company-os/fleet.json` manifest → generated `.claude/agents/os-<slug>.md` |
| "Files that make the agents useful" | Brain templates in `config/company-os/brain-templates/` |
| MCP tools per agent | `agents[].tools.mcp` (appended to the subagent `tools:` frontmatter) |
| "The human decides. The agents execute." | Autonomy levels (`advisory`/`draft`/`execute`) + mandatory review gate `/os-ship` |
| Review agent "anyone test" before publishing | `role: "review"` agent — forced `advisory` (read-only), mirrors the `aisha-advisor` doctrine |
| Weekly goals / weekly brief | `brain/weekly-brief.md` + `/os-weekly` ritual command |
| Agent map | `company-os/agent-map.md` — **generated** from the manifest, never drifts |
| Model choice per agent | `slot` (`spark`/`ember`/`verify` — Soulforge router vocabulary) → Claude Code `model:` via `slot_models` |
| Marketplace / platform growth path | `npm run company-os:agent-spec -- <slug>` emits a `plugin_catalog.agent_spec` draft |

## 3. Layout

```
config/company-os/
  presets/one-person-company.json   # 10-agent preset (Leads, Research, Docs, Ads,
                                    # Content, Sales, Product, Ops, Finance, Review)
  brain-templates/*.md              # 9 brain file templates

schemas/company-os-fleet.schema.json  # manifest contract ($schema-linkable)

scripts/company-os/
  lib.mjs                           # load / validate / generate (pure, testable)
  cli.mjs                           # init | gen | check | agent-spec

company-os/                         # USER-OWNED instance (created by init, committed)
  fleet.json                        # your fleet — edit freely
  brain/*.md                        # your business brain — edit freely
  agent-map.md                      # generated overview (auto-gen marker)

.claude/agents/os-<slug>.md         # generated subagents (one per fleet agent)
.claude/commands/os-<slug>.md       # generated /os-<slug> commands
.claude/commands/os-ship.md         # generated review-gate ritual
.claude/commands/os-weekly.md       # generated weekly planning ritual
```

Everything generated carries the standard auto-gen marker and is written through
`safeWriteSync` — user-owned files are refused, `<!-- aisha:user-section -->`
blocks survive regeneration, identical content is skipped. Same contract as
`npm run gen:ide`.

## 4. Usage

```bash
npm run company-os:init                   # scaffold company-os/ from the preset
# … edit company-os/brain/*.md (fill in your voice, offers, context)
# … edit company-os/fleet.json (add/remove/retune agents)
npm run gen:company-os                    # (re)generate .claude artifacts
npm run gen:company-os:check              # CI drift check (no-op if no instance)
npm run company-os:agent-spec -- leads    # emit agent_spec draft for publishing
```

Then in Claude Code: `/os-leads find 20 sponsor prospects for the newsletter`,
`/os-weekly`, `/os-ship drafts/launch-post.md`.

## 5. Manifest reference (`company-os/fleet.json`)

Contract: [`schemas/company-os-fleet.schema.json`](../schemas/company-os-fleet.schema.json).
Shared fields deliberately use the same names/semantics as
`plugin_catalog.agent_spec` (see `aisha/db/sql/functions/materialize_agent_runtime.sql`).

```jsonc
{
  "$schema": "../schemas/company-os-fleet.schema.json",
  "version": 1,
  "preset": "one-person-company",       // informative provenance
  "prefix": "os",                       // artifact prefix → os-leads, /os-leads
  "owner": { "name": "…", "decision_seat": true },
  "slot_models": {                      // Soulforge slot → Claude Code model
    "spark": "haiku", "ember": "sonnet", "verify": "opus", "default": "inherit"
  },
  "defaults": {
    "slot": "ember",
    "autonomy_level": "draft",
    "brain": ["who-i-am.md", "what-i-do.md", "operating-context.md"]
  },
  "agents": [
    {
      "slug": "leads",                  // ^[a-z0-9][a-z0-9-]{0,30}$, unique
      "title": "Leads Agent",
      "purpose": "Finds leads, buyers, and partnership targets.",
      "mission": "leads → buyers",      // one-line value transform
      "best_for": "Outbound, sponsors, and B2B prospecting.",
      "tip": "Pull leads by role, industry, company size, and buying intent.",
      "slot": "ember",                  // spark | ember | verify | default
      "autonomy_level": "draft",        // advisory | draft | execute
      "role": "worker",                 // worker | review (max one review)
      "brain": ["weekly-brief.md"],     // merged after defaults.brain, deduped
      "outputs": "Ranked lead list with intent evidence and an opening line.",
      "tools": {                        // optional — derived from autonomy if absent
        "claude": ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write", "Edit"],
        "mcp": ["mcp__hubspot__search_contacts"]
      },
      "platform": {                     // optional agent_spec passthrough
        "default_model": "balanced", "context_profile": "repo_plus_rules",
        "max_loops": 3, "safety_level": "standard",
        "rule_slugs": [], "knowledge_items": []
      }
    }
  ]
}
```

### Autonomy levels — "the human decides" made mechanical

| Level | Derived tools | May write files | Outward actions (publish/send/push) |
|---|---|---|---|
| `advisory` | `Read, Grep, Glob` | never (enforced: Write/Edit/Bash **and all MCP tools** rejected by validation — MCP write-capability can't be verified from the tool name, so the read-only guarantee disallows them) | never |
| `draft` | + `Write, Edit, WebSearch, WebFetch` | drafts + `company-os/` proposals | never — hands artifacts to the human |
| `execute` | + `Bash` | yes | still gated by `/os-ship` + explicit human go |

The `review` agent is forced `advisory` — that is the decision-seat guarantee.
This mirrors the AISHA Dirigent supervision doctrine (advisory-only hooks,
read-only `aisha-advisor`): the fleet drafts and recommends, the human ships.

### Slots — router vocabulary, not provider names

`slot` reuses the Soulforge slot names from `.aisha/dirigent.json`
`routerCoach.slotProfiles` (`spark` = cheap/fast, `ember` = balanced,
`verify` = highest quality). `slot_models` maps slots to Claude Code models so
the same fleet definition stays meaningful when it later routes through the
LLM Gateway (where the slot is resolved by the active profile instead).

## 6. Brain files

| File | Feeds | Content |
|---|---|---|
| `who-i-am.md` | voice-bearing agents | operator identity, voice, non-negotiables |
| `what-i-do.md` | all | offers, pricing anchors, ICP, positioning |
| `style-rules.md` | content/ads/sales/review | voice rules, banned phrases, formats |
| `operating-context.md` | all | current-state snapshot: stage, constraints, priorities |
| `weekly-brief.md` | ops/leads | this week's goals; updated via `/os-weekly` |
| `process-files.md` | ops/docs/product | SOP index — every repeated task becomes a process |
| `wins-log.md` | sales/content/finance | dated wins = proof points for outreach and drafts |
| `review-prompt.md` | review | the "anyone test" checklist |
| `mcp-tools.md` | human + all | inventory of connected MCP servers/tools per agent |

Rules: brain files are the single source of truth (agents must read them before
working and must not invent business facts); they are committed and versioned
like code; **no secrets** — the generator warns on credential-looking patterns
and secret material belongs in env/secret managers per repo security rules.

## 7. Growth path (local → platform)

1. **Local (this layer):** fleet runs as Claude Code subagents; memory in git.
2. **Marketplace:** `company-os:agent-spec` maps an agent to a
   `plugin_catalog.agent_spec` draft (`purpose`, `default_model`,
   `allowed_tools`, `autonomy_level`, `rule_slugs`, …) for `publish_agent` →
   `materialize_agent_runtime` (routable `agent_catalog` row) or
   `install_agent_as_story` (consumer-owned story + ruleset).
3. **n8n runtime:** a materialized agent becomes a Personal Agent
   (`AishaLlmRouter` + MCP tools) per `docs/N8N_AGENT_ARCHITECTURE.md`;
   brain files map to `agent_knowledge_bindings` / knowledge items.
4. **Flowboard:** `get_flowboard_registry` already federates `agent_catalog`,
   so promoted fleet agents appear in the visual builder palette.

The manifest is the stable contract across all four stages; only the
provisioning target changes.

## 8. CI & safety

- `npm run gen:company-os:check` exits non-zero when generated artifacts drift
  from the manifest; it is a **no-op success** in repos with no `company-os/`
  instance, so it is safe to wire into shared pipelines.
- Generation is deterministic (no timestamps in output) — check mode is a pure
  content diff; the header carries a manifest fingerprint for traceability.
- Validation rejects unexpected shapes (unknown slots/autonomy, duplicate
  slugs, write tools on advisory agents, missing brain files) instead of
  coercing them.
