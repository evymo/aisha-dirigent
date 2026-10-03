---
name: aisha-supervisor
description: AISHA Dirigent runtime supervision overlay for Claude Code agents. Use when working in this repo to understand how the agent is being advised in real time (PreToolUse / PostToolUse / Stop hooks), how to read advisory output, how to invoke the manual review subagent, and how the advisory-only principle applies. Triggers on "supervisor", "advisor", "advisory hook", "Dirigent supervision", "aisha hook", "aisha-advise", "loop continuation", "goal evaluator".
---

# AISHA Dirigent — Runtime Supervision (Claude Code)

> Sister capability to artifact generation (`npm run gen:ide`). Where artifact
> generation provides "what tools the agent has" (skills, commands, CLAUDE.md),
> the supervisor provides "expert eyes watching the agent reason in chat".

## Zlatá pravidla

1. **Advisory-only.** Hooks NEVER fix code, NEVER modify `tool_input`, NEVER
   block actions with `decision: "deny"`. They only `additionalContext`-inject
   text the agent may consider.
2. **The single intervention point** is the `Stop` hook returning
   `decision: "block"` — this is loop continuation ("you're not done by
   acceptance criteria"), not a code fix. The agent decides how to proceed.
3. **Práce zůstává na agentovi.** Dirigent supervisor je expert dohlížitel,
   ne policeman. Když advisory přijde, agent ji přečte a sám rozhodne, zda
   reaguje.
4. **Cold-start parita.** Bez `AISHA_MCP_TOKEN` env: HTTP relay tichý no-op,
   Vrstva 1 (lokální regex hooks) stále funguje. Bez backend deploye edge fn
   vrací `{}`. Bez n8n: goal_evaluator timeoutne fail-open. Každá vrstva je
   degradable bez blokování práce.

## Třívrstvá architektura

```
┌─────────────────────────────────────────────────────────────────┐
│ Vrstva 1 — Lokální regex hooks (always-on, no network)         │
│ .claude/hooks/aisha-advise-{rpc,console,any,i18n,bash-risk}.sh │
│ + _aisha-advise-lib.sh helper                                   │
│ Per-session 45s cooldown via /tmp timestamp file                │
└─────────────────────────────────────────────────────────────────┘
            │  fires on PreToolUse(Edit|Write|MultiEdit|Bash)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Vrstva 2 — HTTP advisory (deferred until backend deployed)      │
│ When backend is ready, add to .claude/settings.json:            │
│   { "type": "http", "url": "${AISHA_SUPERVISOR_URL}",           │
│     "headers": {"Authorization": "Bearer ${AISHA_MCP_TOKEN}"}}  │
│ → backend supervisor → n8n WF_DIRIGENT_AGENT (goal_evaluator…)  │
│ See docs/aisha-dirigent-supervisor-backend-deploy.md            │
└─────────────────────────────────────────────────────────────────┘
            │  (when wired, fires on SessionStart, UserPromptSubmit,
            │   PostToolUse, Stop — all via Claude Code's native HTTP hook)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Vrstva 3 — Read-only subagent (deep on-demand review)           │
│ .claude/agents/aisha-advisor.md                                 │
│ Tools: Read, Grep, Glob, mcp__aisha-knowledge__*                │
│ NO Bash/Edit/Write — enforced by frontmatter, not just policy   │
└─────────────────────────────────────────────────────────────────┘
```

## Jak agent rozumí advisory výstupu

Když hook vyemituje advisory přes `additionalContext`, vypadá to jako:

```
⚠️  AISHA Advisor — RPC-only law (advisory)

Detekuji direct table access pattern: .from("...").(select|...|...).
AISHA Development Law #7 doporučuje data access přes supabase.rpc('mcp_…', {...})
...
Advisory only — nepovinné, agent rozhodne.
```

**Jak na to reagovat:**
- Pokud advisory dává smysl pro current task: implementuj doporučení (bez
  pingnutí usera — to je tvoje rozhodnutí jako agent).
- Pokud je false positive (např. advisory na `.from(` v komentáři, v testu,
  v migraci): pokračuj a v dalším turn-u můžeš zmínit, že jsi to ignoroval
  s důvodem.
- Pokud nejsi si jistý: vyvolej `aisha-advisor` subagent přes `/aisha-advise`
  pro hlubší review.

**Cooldown awareness:** stejný hook se neopakuje častěji než 1× za 45s.
Pokud se domníváš, že hook měl fire ale nestal se: zkontroluj
`/aisha-cooldowns` slash command, případně clearni.

## Stop hook — autonomní goal pursuit

Toto je **kritická a unikátní vlastnost Vrstva 2 supervisoru**. Když ukončuješ
turn (`Stop` event), backend `goal_evaluator` playbook posoudí transcript
proti `story_goal_state.acceptance_criteria` a může vrátit:

- `{decision: "allow"}` — cíl splněn, můžeš končit.
- `{decision: "block", reason: "Story criterion 3/5 chybí: <details>. Doporučený směr: <action>."}` — **agent automaticky pokračuje** s reason jako další pokyn (ne jako patch — jako "popřemýšlej a pokračuj").

Tento mechanismus = autonomní goal pursuit bez user intervence. Loop má cap
12 iterací (`story_goal_state.loop_max`); po dosažení backend přepne na
`decision: "ask"` a eskaluje na usera.

**Bez backend deploye:** Stop hook timeoutne fail-open → agent ukončí turn
normálně. Žádný autonomní loop. To je v pořádku — jen méně schopností.

## Slash commands

| Command | Účel |
|---|---|
| [`/aisha-advise`](.claude/commands/aisha-advise.md) | Manuální review přes `aisha-advisor` subagent (hluboký, on-demand) |
| [`/aisha-supervise`](.claude/commands/aisha-supervise.md) | Status: aktivní hooks, story, fingerprint, backend connectivity |
| [`/aisha-cooldowns`](.claude/commands/aisha-cooldowns.md) | List / clear cooldown timers (45s per rule per session) |
| [`/aisha-story`](.claude/commands/aisha-story.md) | Manage `.aisha/story.json` (story_id pro supervisor scope) |

## When to invoke each surface

| Situation | Surface |
|---|---|
| Working naturally — every Edit/Bash | **Hooks fire automatically** (Vrstva 1, no-op for you) |
| Backend deployed + token set | **HTTP relay fires automatically** on SessionStart/PostToolUse/Stop |
| Want strategic checkpoint mid-task | `/aisha-advise` (subagent review) |
| Debugging: "advisory didn't fire" | `/aisha-supervise` then `/aisha-cooldowns` |
| New repo / no `.aisha/story.json` | `/aisha-story <uuid>` |
| Want to bypass cooldown for testing | `/aisha-cooldowns clear` |

## Soubory

| Soubor | Role |
|---|---|
| `.claude/hooks/aisha-advise-*.sh` | Vrstva 1 lokální regex advisors |
| `.claude/hooks/_aisha-advise-lib.sh` | Sdílený helper (extract_new_text, cooldown) |
| `.claude/settings.json` `hooks[event].type:"http"` (deferred) | Vrstva 2 — added when backend supervisor is deployed |
| `.claude/agents/aisha-advisor.md` | Vrstva 3 read-only review subagent |
| `.claude/settings.json` | Hook registrace (`_aisha`-marked entries) |
| `.env.example` | Dokumentace `AISHA_MCP_TOKEN`, `AISHA_SUPERVISOR_URL` |
| `supabase/functions/dirigent-supervisor/index.ts` | Vrstva 2 edge fn (deploy-pending) |
| `aisha/db/migrations/20260501000000_dirigent_supervisor.sql` | Schema migrace |
| `n8n/workflows/README-dirigent-supervisor.md` | Playbook deploy guide |

## Rozdíl proti VS Code extension `evymo-dirigent`

VS Code extension dělá totéž přes:
- `copilot-watcher.ts` → onDidChangeTextDocument + regex (= Vrstva 1)
- `aisha-push.ts` → backend nudges (= dirigent_nudges queue table)
- `participant.ts` → @aisha chat participant (= MCP `aisha-knowledge` tools + aisha-advisor subagent)
- `auto-flow.ts` → autonomní goal pursuit (= Stop hook + goal_evaluator)

V Claude Code získáme stejný supervisor shape přes hook + MCP + subagent.
Funkční parita; surfaces jsou jiné.

## Když supervisor zlobí

1. **Advisory text neperzistentní mezi turny:** to je správně — `additionalContext`
   se injektuje per-event. Pokud chceš trvalý kontext, story brief v
   SessionStart hooku to dělá.
2. **Hook nefire:** zkontroluj cooldown (`/aisha-cooldowns`). Pokud je čistý,
   ověř file path matchne pattern (TS/TSX hooky ignorují `.md`).
3. **Stop hook nikdy neblokne:** backend musí mít deployed migration +
   edge fn + n8n `goal_evaluator` playbook. Bez něj fail-open. Sleduj
   `/aisha-supervise` connectivity check.
4. **MCP tools nedostupné v `aisha-advisor`:** ověř `.mcp.json`, restartuj
   Claude Code session.
