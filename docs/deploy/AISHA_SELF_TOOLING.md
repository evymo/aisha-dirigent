# AISHA_SELF_TOOLING.md — Vlastní výroba skills, hooks, commands

> **Status:** IMPLEMENTED — META-2 vrstva nad [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md)
> **Verze:** 1.1
> **Datum:** 2026-06-06 (orig. spec 2026-04-28)

---

## ⚠️ Implementation status & corrections (2026-06-06)

Celá smyčka je **postavená a code-complete**: DB tabulka `aisha_tooling_proposals` + 6 RPC
(v baseline), `WF_AISHA_TOOLING_OBSERVER`, tři factory workflows
(`WF_AISHA_{SKILL,HOOK,COMMAND}_FACTORY`), `WF_AISHA_TOOLING_COMMITTER` a admin approval
page v `appsmith/dashboards/aisha-ops.template.json`. **Tam, kde se tělo tohoto specu
níže liší od kódu, platí kód** — spec byl psán dopředu a v těchto bodech zastaral:

1. **Kdo zakládá proposal:** NE observer. Observer jen detekuje vzory a fan-outuje
   `{pattern, target_factory}` na factory webhooky. **Proposal zakládá až factory**
   (`propose_tooling_artifact` s `p_content` = obsahem vyrenderovaným přes Anthropic
   `/v1/messages`). Nový proposal má `approval_status='pending'` (default).
2. **`ready_for_approval` NEEXISTUJE.** Enum `approval_status` = `pending | approved |
   rejected | expired | committed | reverted`. Stav "čeká na approval" = `pending`.
   Admin schválení nastaví `approved`. (Kdokoli kdo by volal RPC s `ready_for_approval`
   dostane `Invalid status` / CHECK violation.)
3. **DB sloupec je `artifact_content`**, ne `rendered_content` (to je jen interní název
   pole ve factory n8n nodu).
4. **Dvoukroková admin brána:** Approve (`status→approved`) a Commit (fires committer)
   jsou **dvě samostatná tlačítka**. Committer řeší proposal **přímo podle id** a
   guarduje `approval_status='approved'` — NEpoužívá `get_pending_tooling_proposals`
   (ten filtruje `pending`, takže schválený proposal by nikdy neviděl).
5. **Forgejo token env var:** committer čte `FORGEJO_API_TOKEN` (operator secret z
   `.env-prod-backup`; cold-start z něj odvozuje alias `FORGEJO_TOKEN`).

Regression guard pro body 1–4 je v `src/tests/gates/aisha-self-tooling.gate.test.ts` §8.

---

## TL;DR

AISHA je **autorizovaný autor svých vlastních nástrojů** v Claude Code prostředí. Detekuje ze sebe vlastních pozorování (audit_journal, integration_actions, gate test failures, drift patterns) opakující se třídy chyb a navrhuje k nim:
1. **Skill** (`.claude/skills/{name}/SKILL.md`) — když chyba je z neznalosti vzoru/contractu
2. **Hook** (`.claude/hooks/{name}.sh` + zápis do `.claude/settings.json`) — když chyba je deterministicky detekovatelná před commitem
3. **Slash command** (`.claude/commands/{name}.md`) — když opakovaný workflow má smysl jako jednorázová zkratka

Návrhy jdou do tabulky `aisha_tooling_proposals`. Admin schvaluje. Po schválení AISHA commituje do Forgejo přes vlastní stack (žádné GitHub PR magic).

---

## 1. Filosofie

### 1.1 Nevýhody hand-coded toolingu

- Devops/admins nemají čas psát skills každý týden
- Chyby AISHA dělá v Claude Code prostředí jsou **opakující se vzory** (kterými je dáno mlžení specifikace, ne lidská kreativita)
- Statická .claude/ složka vůbec nereflektuje běžící realitu projektu

### 1.2 AISHA-driven self-tooling

| Aspekt | Hand-coded | AISHA-driven |
|---|---|---|
| Detekce nutnosti | Devops si všimne | AISHA z audit_journal patternů |
| Návrh řešení | Devops píše ručně | AISHA generuje + admin schvaluje |
| Validace | Reviewer | gate test + risk evaluator |
| Distribuce | Manual git commit | Forgejo commit z AISHA stacku |
| Reflexe | TBD | Telemetrie use-rate per skill, drift detection per hook |

### 1.3 Co AISHA NESMÍ

- Smazat existing skill/hook/command bez approval (HIGH risk, vždy gate)
- Měnit `.claude/settings.json` schema (jen append/remove discrete entries)
- Commitnout do main branch bez admin approval
- Přepisovat `CLAUDE.md` (architektonická pravidla = human-only territory)

---

## 2. Tříkomponentní architektura

```
┌─────────────────────────────────────────────────────────────┐
│  WF_AISHA_TOOLING_OBSERVER (cron daily 02:30)               │
│  ├─ get_audit_aggregates RPC (last 7d)                       │
│  ├─ Detect patterns (code node):                             │
│  │  ├─ Repeated gate failures → propose skill/hook           │
│  │  ├─ Repeated drift_kind → propose hook                    │
│  │  ├─ Manual hot-fix patterns → propose command             │
│  │  └─ Slow workflows → propose skill optimization           │
│  └─ propose_tooling_artifact RPC → aisha_tooling_proposals   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  WF_AISHA_{SKILL,HOOK,COMMAND}_FACTORY (webhook-triggered)  │
│  ├─ lock_tooling_proposal (atomic, prevents dupe work)       │
│  ├─ Render artifact via prompt to LLM (Anthropic API direct) │
│  ├─ Validate generated artifact (gate test compatibility)    │
│  ├─ Store rendered_content + validation_result in proposal    │
│  └─ propose_tooling_artifact(...) → status 'pending'         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Admin reviews via Appsmith dashboard (Phase 4 page)         │
│  ├─ Approves → triggers WF_AISHA_TOOLING_COMMITTER           │
│  └─ Rejects → update_tooling_proposal_status('rejected')     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  WF_AISHA_TOOLING_COMMITTER (webhook-triggered)              │
│  ├─ Forgejo API: create branch `aisha/tooling/<proposal_id>` │
│  ├─ Forgejo API: write file (skill MD / hook .sh / cmd MD)   │
│  ├─ Forgejo API: open PR + assign admin                      │
│  ├─ update_tooling_proposal_status('committed', pr_url)      │
│  └─ Send notification to admin                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Datová surface

### 3.1 `aisha_tooling_proposals` table

> Schema je **autoritativní** — viz migrace `20260428105000_aisha_self_tooling_proposals.sql`. Tato sekce je dokumentační kopie pro orientaci.

```sql
CREATE TABLE public.aisha_tooling_proposals (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at         timestamptz  NOT NULL DEFAULT now(),
  proposal_kind       text         NOT NULL CHECK (proposal_kind IN ('skill','hook','command')),
  artifact_name       text         NOT NULL,           -- 'aisha-blue-green-debug'
  artifact_path       text         NOT NULL,           -- '.claude/skills/.../SKILL.md'
  artifact_content    text         NOT NULL,           -- final rendered content (skill MD / hook .sh / command MD)
  trigger_pattern     jsonb        NOT NULL,           -- detected pattern (action_sequence, occurrence_count, success_rate)
  occurrence_count    int          NOT NULL DEFAULT 0,
  decision_provenance jsonb        NOT NULL DEFAULT '[]'::jsonb,
  approval_status     text         NOT NULL DEFAULT 'pending'
                      CHECK (approval_status IN (
                        'pending', 'approved', 'rejected', 'expired',
                        'committed', 'reverted'
                      )),
  approval_id         uuid,
  approved_by         uuid,
  approved_at         timestamptz,
  committed_sha       text,                            -- Forgejo commit SHA po merge
  committed_at        timestamptz,
  reverted_sha        text,                            -- pokud reverted později
  reverted_at         timestamptz,
  manual_locked       boolean      NOT NULL DEFAULT false,  -- admin lock, AISHA neoverwrites
  proposal_bundle_id  uuid,                            -- groups souvisící proposals (skill + hook same pattern)
  metadata            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (proposal_kind, artifact_path)
);
```

**Stavový stroj:**

```
  pending ──approve──► approved ──commit──► committed ──revert──► reverted
     │                    │
     ├──reject──► rejected
     └──expire──► expired
```

- `pending` — AISHA navrhla, čeká na admin
- `approved` — admin schválil, čeká na committer
- `rejected` — admin odmítl s reason v `metadata.rejected_reason`
- `expired` — proposal stará >7 dní bez akce, auto-expire
- `committed` — Forgejo PR vytvořen + smerged, `committed_sha` populated
- `reverted` — admin/AISHA vrátila zpět, `reverted_sha` populated

`UNIQUE (proposal_kind, artifact_path)` zabraňuje duplicitě. `manual_locked = true` chrání artefakty po admin manual úprave (AISHA respektuje "lidský dotek").

### 3.2 RPCs

| RPC | Účel | Auth |
|---|---|---|
| `propose_tooling_artifact(p_kind, p_name, p_path, p_content, p_pattern, p_provenance)` | Insert new proposal s dedup check | service_role |
| `get_audit_aggregates(p_days int)` | Aggregate gate failures + drift patterns + manual sequences | service_role |
| `lock_tooling_proposal(p_id uuid, p_lock_owner text)` | Atomic claim factory worka přes manual_locked flag | service_role |
| `update_tooling_proposal_status(p_id, p_new_status, p_metadata)` | State transitions s validation | service_role |
| `get_pending_tooling_proposals(p_kind text DEFAULT NULL)` | Dashboard query (filtered by kind nebo all pending) | authenticated |
| `get_tooling_proposal_count_pending()` | StatBox widget | authenticated |

---

## 4. Pattern detection v `Detect Patterns` code node

### 4.1 Skill candidate signals

```typescript
// Repeated same kind of gate failure across multiple PRs
// → suggests devops/AISHA repeatedly stumble on same contract
{
  gate_test: 'aisha-rpc.gate.test.ts',
  failure_count: 12,
  unique_authors: 3,
  failure_messages: [...],
  → propose: skill teaching the contract
}

// Repeated similar Sentry issues with same root cause label
{
  sentry_root: 'TypeError: cannot read properties of undefined',
  app_name: 'aisha-gateway',
  issue_count: 8,
  → propose: skill 'safe-property-access' or hook
}
```

### 4.2 Hook candidate signals

```typescript
// Drift kind that's been auto-remediated 5+ times in week
// → deterministic enough to be hook (catch before commit)
{
  drift_kind: 'env_var_missing',
  app_name: 'aisha-gateway',
  remediation_count: 7,
  → propose: hook 'env-completeness-check.sh'
}

// Same compose validation error in CI 3+ times
{
  ci_failure: 'docker-compose.coolify-X.yml: missing healthcheck',
  count: 4,
  → propose: hook 'compose-healthcheck-check.sh'
}
```

### 4.3 Command candidate signals

```typescript
// Same multi-step manual playbook executed by admin >5 times
// → opakovaný workflow s parametrizací = slash command
{
  audit_pattern: ['acquire_lock', 'fetch_state', 'patch_config', 'verify', 'commit'],
  occurrences: 6,
  → propose: command '/restore-app-state'
}
```

### 4.4 Detekční pravidla v code node

```typescript
function detectProposals(aggregates) {
  const proposals = [];

  // Skill: ≥5 same gate failure with unique authors >= 2
  for (const gate of aggregates.gate_failures) {
    if (gate.count >= 5 && gate.unique_authors >= 2) {
      proposals.push({
        artifact_kind: 'skill',
        proposed_name: `aisha-${gate.gate_name.replace('.gate.test.ts', '')}`,
        rationale: `Gate ${gate.gate_name} failed ${gate.count}× across ${gate.unique_authors} authors — pattern of misunderstanding`,
        evidence: { gate_failures: [gate] },
      });
    }
  }

  // Hook: ≥5 same drift_kind + auto-remediated
  for (const drift of aggregates.drift_patterns) {
    if (drift.count >= 5 && drift.remediation === 'auto') {
      proposals.push({
        artifact_kind: 'hook',
        proposed_name: `prevent-${drift.drift_kind.replace('_', '-')}`,
        rationale: `Drift kind ${drift.drift_kind} auto-remediated ${drift.count}× — deterministic enough for pre-commit hook`,
        evidence: { drift_patterns: [drift] },
      });
    }
  }

  // Command: ≥5 same manual workflow sequence
  for (const seq of aggregates.manual_sequences) {
    if (seq.occurrences >= 5) {
      proposals.push({
        artifact_kind: 'command',
        proposed_name: `aisha-${seq.suggested_slug}`,
        rationale: `Manual sequence repeated ${seq.occurrences}× — candidate for slash command`,
        evidence: { manual_sequences: [seq] },
      });
    }
  }

  return proposals;
}
```

---

## 5. Factory workflows

### 5.1 `WF_AISHA_SKILL_FACTORY`

Webhook input:
```json
{ "proposal_id": "uuid", "lock_owner": "execution-id" }
```

Steps:
1. `lock_tooling_proposal(proposal_id, lock_owner)` — atomic
2. Read proposal record (rationale, evidence)
3. Render skill content via Anthropic API call:
   - Prompt template: `prompts/skill-factory.md` (input: rationale, evidence, target path; output: SKILL.md content)
   - Model: claude-sonnet-4-5 (consistent with platform standard)
   - Max tokens: 4000 (skills are typically 200-400 lines)
4. Validate rendered content:
   - YAML frontmatter parses + has `name` + `description`
   - Description length 100-500 chars
   - Body has at least 3 sections (## headings)
5. `propose_tooling_artifact(p_kind, p_name, p_path, p_content=rendered_content, p_trigger_pattern, ...)` → vloží řádek se `approval_status='pending'`
6. POST `/webhook/approval-gate` (WF_APPROVAL_GATE) → risk eval + notifikace adminovi

### 5.2 `WF_AISHA_HOOK_FACTORY`

Same flow, different prompt + validation:
- Prompt template: `prompts/hook-factory.md`
- Validation:
  - `bash -n` syntax check
  - Reads `CLAUDE_HOOK_TOOL_INPUT` env var
  - Has clear exit code semantics (0 = allow, 1 = block)
  - Doesn't shell out to network (security)
- Plus: emit the `settings.json` registration target. The `Validate + Derive Identity`
  node derives `hook_event` + `hook_matcher` (default `PreToolUse` / `Edit|Write|MultiEdit`,
  overridable via `pattern.hook_event` / `pattern.hook_matcher`) and `Propose Hook Artifact`
  threads them to the proposal as `p_metadata.settings_patch = { event, matcher }`. The
  committer reads this as its highest-priority source when wiring `.claude/settings.json`
  (§6 step 4); if absent it falls back to the same defaults. The command (`${CLAUDE_PROJECT_DIR}/<path>`)
  is derived by the committer from `artifact_path`.

### 5.3 `WF_AISHA_COMMAND_FACTORY`

Same flow, different prompt + validation:
- Prompt template: `prompts/command-factory.md`
- Validation:
  - Markdown frontmatter parses
  - Has `name` + `description` + `arguments` schema (if any)
  - References valid tools/commands

---

## 6. Forgejo committer

### 6.1 `WF_AISHA_TOOLING_COMMITTER`

Webhook input (after admin approval):
```json
{ "proposal_id": "uuid", "approved_by": "user_id" }
```

Steps:
1. Read proposal record (rendered_content, proposed_path, artifact_kind)
2. Forgejo API: `POST /api/v1/repos/{owner}/{repo}/branches`
   ```json
   { "new_branch_name": "aisha/tooling/{proposal_id}", "old_branch_name": "main" }
   ```
3. Forgejo API: `POST /api/v1/repos/{owner}/{repo}/contents/{path}` (s `branch` query)
   ```json
   {
     "message": "feat(aisha-tooling): {artifact_kind} {proposed_name}\n\nProposal: {rationale}\n\nRef: aisha_tooling_proposals.id={proposal_id}",
     "content": "{base64(rendered_content)}",
     "new_branch": "aisha/tooling/{proposal_id}"
   }
   ```
4. **For `proposal_kind = 'hook'` only**: a hook `.sh` is inert until it is registered
   in `.claude/settings.json`. The committer therefore makes a **second commit on the
   same `aisha/tooling/<proposal_id>` branch** (node chain `Is Hook Proposal? →
   Read Settings JSON → Merge Hook Entry → Patch Settings JSON`):
   - `GET /contents/.claude/settings.json?ref=<branch>` → current file (content + blob sha)
   - merge in one hook entry, idempotently (never double-add the same `command` under the
     same matcher), then `PUT /contents/.claude/settings.json` with the blob sha
   - **event + matcher derivation** (most specific wins): `metadata.settings_patch`
     `{ event, matcher, command }` (factory-rendered) → `metadata.hook_event` /
     `metadata.hook_matcher` → `trigger_pattern.event` / `trigger_pattern.matcher` →
     default `PreToolUse` on `Edit|Write|MultiEdit`. An unknown event coerces to `PreToolUse`.
   - the injected entry is tagged `_aisha: { kind: 'self-tooling', managed: true, proposal_id }`
   - skills and commands are standalone files and skip this step (gated by `Is Hook Proposal?`)
5. Forgejo API: `POST /api/v1/repos/{owner}/{repo}/pulls`
   ```json
   {
     "title": "AISHA tooling proposal: {artifact_kind} {proposed_name}",
     "body": "...rationale + evidence summary...",
     "head": "aisha/tooling/{proposal_id}",
     "base": "main",
     "assignees": ["{admin_username}"]
   }
   ```
6. `update_tooling_proposal_status(proposal_id, 'committed', { forgejo_pr_url, forgejo_branch })`

### 6.2 Auth

Forgejo token uložen v `FORGEJO_API_TOKEN` env var (cold-start z něj odvozuje alias `FORGEJO_TOKEN`). Scoped na single repo + write permission. Token rotace přes `WF_PKI_CERT_ROTATION` (TBD — out-of-scope V1).

---

## 7. Admin approval UI (Phase 4 dashboard)

Dashboard má novou page **"AISHA Self-Tooling"**:

| Sekce | Widget | Data |
|---|---|---|
| Pending Proposals | TableWidget | `get_pending_tooling_proposals` (filtruje `approval_status='pending'`) |
| Recent Activity | TableWidget | last 30 proposals, all statuses |
| Stats | StatBoxWidgets × 4 | pending count, approved this week, rejected this week, committed |
| Detail Panel | ContainerWidget (drilldown) | Selected proposal: rationale, evidence, rendered_content (read-only code view) |
| Action Buttons | ButtonWidget × 2 | "Approve & Commit" / "Reject with reason" |

Action buttons jsou admin-gated (viz APPSMITH_AISHA_OPS.md §5.2).

---

## 8. Risk evaluation

`fn_evaluate_proposal_risk` rozšířen o nové kategorie:

| Kategorie | Default risk | Override pravidla |
|---|---|---|
| `tooling_proposal` | low | Detekce, jen log |
| `tooling_render` | low | Factory běží, nic nemění v repo |
| `tooling_commit` | high | Vždy approval gate (zápis do .claude/, dotýká celého týmu) |

---

## 9. Bezpečnostní úvahy

### 9.1 Rendered content sandbox

LLM-generovaný obsah neaplikujeme přímo do .claude/. Jde nejdřív do:
1. `aisha_tooling_proposals.artifact_content` (DB string)
2. Validation gate (parse + lint)
3. Admin review (UI)
4. Forgejo PR (admin merge)

Žádný step nepíše přímo do filesystému core stacku.

### 9.2 Prompt injection

LLM dostává jen:
- Rationale (AISHA-generated, ze známých patternů)
- Evidence (DB-derived, schema-validated)
- Path constraints (explicit allowlist)

Není tam user-controlled input. Risk prompt injection je low.

### 9.3 Token gating

Anthropic API key (`ANTHROPIC_API_KEY`) je dostupný jen pro factory workflows. n8n credentials store, scoped k těmto workflows. Žádný jiný workflow nesmí volat Anthropic přímo.

---

## 10. Telemetrie a self-reflection

### 10.1 Skill usage tracking

Každý invoke skill (přes Claude Code) loguje do `audit_journal`:
```json
{ action: 'skill_invoked', metadata: { skill_name, user_id, session_id } }
```

Aggregate per-skill use-rate. Pokud skill 30 dní 0 invokes → AISHA navrhne removal proposal (rare, but valid signal).

### 10.2 Hook hit rate

Per hook, count `block` vs `allow` exits. Pokud hook >100 invokes a 0 blocks → it's noise, navrhnout remove.

### 10.3 Command popularity

Per slash command, count invocations. Top 10 stays, bottom suggested for review.

---

## 11. Otevřené otázky

1. **AISHA self-modify of CLAUDE.md**: aktuálně out-of-scope. CLAUDE.md je human-only territory (architektura). Mohlo by mít smysl AISHA navrhuje **diff** k CLAUDE.md, který admin posuzuje? — *future work, ne V1*
2. **Test factory**: AISHA navrhne skill, ale jak se ověří, že skill je *užitečný*? Eval = retrospektivní replay scénáře, kdy by se skill aplikovala? — *future enhancement*
3. **Cross-project AISHA tooling**: pokud AISHA běží jako stack v jiných projektech (open-source), může sdílet skill catalog? Marketplace? — *very future, mimo scope*

---

## 12. Reference

- [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md) — META-1 vrstva
- [APPSMITH_AISHA_OPS.md](APPSMITH_AISHA_OPS.md) — admin UI pro proposals
- [`.claude/settings.json`](../../.claude/settings.json) — current hooks registry
- [`.claude/skills/`](../../.claude/skills/) — current skills catalog
- [Anthropic API: Messages](https://docs.claude.com/en/api/messages)
- [Forgejo API: Repository Contents](https://forgejo.org/docs/latest/user/api-usage/)
- [SEED_DATA_LAYERS_TENANT_SEPARATION.md](../architecture/SEED_DATA_LAYERS_TENANT_SEPARATION.md) — seed vrstvy (platform/implementation/instance)

---

## 13. Layering & klasifikace (OSS base ↔ expert overlay)

> Konsoliduje rozhodnutí: kam patří „znalost" factory šablon. Krátce: **strukturální
> formát = OSS base; expertní znalost KDY/JAK = per-instance produkční data = služba.**

### 13.0 Co je OSS a co je služba (business framing)

- **OSS = infrastruktura.** Celá platforma, self-tooling smyčka, schema, generický Tier 0
  base — to je **engine, který si kdokoli může vzít a sám přizpůsobit** pro vlastní nasazení.
  Právě proto musí být celý stack postavený na OSS + permisivních závislostech (OSS-only
  pravidlo): aby byl **adaptovatelný**, ne aby byl „produkt zadarmo".
- **`seed/instance/` (aisha.guru) = naše služba.** Expertní KB konkrétní instance je to
  **proprietární** — naladěná, zúžená kurátorská přesnost, kterou poskytujeme jako službu.
  Žije v privátní instance vrstvě, **nikdy** v OSS repu.

> Tj. open-source nedáváme jako produkt — dáváme **infrastrukturu**. Produktem je ta
> zúžená, expertní vrstva konkrétního nasazení (aisha.guru). Kdokoli si může postavit
> vlastní instanci na téže infrastruktuře; naše hodnota je v *našem* `seed/instance/`.

### 13.1 Nosná teze — scope-narrowing = přesnost

> Každá stack implementace má **vlastní expertní knowledge base**, vlastní té instanci.
> Tím, jak se scope zužuje po vrstvách, roste **přirozeně vyšší přesnost** tam, kde je
> custom nasazení správné — model přestává hádat napříč vším a odpovídá v rámci toho, co
> pro dané nasazení platí.

To je *celý důvod*, proč expertní znalost není OSS, ale per-instance produkční data:
**hodnota služby = ta zúžená, kurátorská přesnost pro konkrétní nasazení.**

**Precision ladder** (každá vrstva ZUŽUJE scope a PŘIDÁVÁ přesnost; užší dědí širší, přes `AISHA_SEED_PROFILE`):

| Vrstva | Scope | KB zdroj | Přesnost |
|---|---|---|---|
| `platform` | generický (všechna nasazení) | schema SoT + `seed/core/` | base — bezpečná, obecná |
| `implementation` | jedna doména/stack (např. medical) | `seed/implementations/<name>/` | doménová |
| `instance` | jedno konkrétní nasazení | `seed/instance/` (private) + live DB | nasazení-specifická |
| `story` | jedna úloha | `knowledge_items WHERE story_id=<uuid>` | úloha-specifická (nejvyšší) |

**Invariant přesnosti:** enrichment je **aditivní a graceful** — užší vrstva nikdy nerozbije
širší. Když instance KB nemá relevantní položku → fallback `instance → implementation →
platform → generický OSS prompt`. Tj. **zúžení = zisk přesnosti BEZ ztráty bezpečné base.**
Vědomý tradeoff: čím užší KB, tím méně generalizuje mimo svůj scope — proto MUSÍ zůstat
Tier 0 (OSS base) jako safety net. Přesnost se kupuje zúžením, **ne nahrazením** base.

### 13.2 Zavedený seam (stejný vzor jako zbytek stacku)

Committed OSS artefakt = deterministický offline baseline; živá DB instance = bohatší expert
verze; consumer čte live-first, jinak fallback bez chyby; paritu hlídá gate.

| OSS base (repo, offline) | Expert / instance (live DB / privátní submodul) | Resolver |
|---|---|---|
| `seed/claude_hook_bindings.json` | `public.claude_hook_bindings` (další řádky) | `Array.isArray(payload?.x)` → live, else seed |
| `expert_rules WHERE is_default=true` | story-scoped `is_default=false` přes `story_rulesets` | `get_instruction_payload`: `v_use_defaults := (rule_ids IS NULL)` |
| `seed/core/` + `translations/` | `seed/instance/` (**prázdné v OSS**, privátní submodul) | `AISHA_SEED_PROFILE` |
| `getFallbackRules()` (hardcoded) | `compose_context` / `search_knowledge` (MCP) | `source: "mcp" \| "fallback"` |

### 13.3 Tři tiery znalosti šablon (self-tooling)

```
Tier 0 — OSS base (offline): generický strukturální prompt (frontmatter, bash strict-mode,
         sekce). Dnes inline v WF_AISHA_*_FACTORY.json. Zůstává jako fallback.
Tier 1 — Expert overlay (instance = SLUŽBA): mcp_search_knowledge(p_query=<pattern>, ...)
         → kurátorské playbooky JAK psát kvalitní artefakt. Seed JEN v seed/instance/ nebo
         live DB. NIKDY v public OSS.
Tier 2 — Per-story: compose_context(p_story_id) přidá acceptance criteria / risk level.
```

Seam: factory node `Fetch Expert Context` (`mcp_search_knowledge`, `onError: continueRegularOutput`).
KB s položkami → injektne do promptu; prázdné → generický Tier 0 prompt. **OSS base se nemění.**

**`code-mastering.md` šablony → Tier 1 KB content** (`knowledge_items`, `item_type='playbook'`),
seedované do **instance vrstvy**, NE do OSS. Factory je „plní" přes enrichment fetch.

### 13.4 Datová klasifikace + invariant

| Artefakt | Klasifikace | Kde žije |
|---|---|---|
| Factory strukturální prompt | OSS base | `WF_AISHA_*_FACTORY.json` (committed) |
| Expert tooling playbooky | **Expert / instance** | `seed/instance/` (private) + live `knowledge_items` |
| Vyrenderovaný `artifact_content` | Instance data (do approvalu) | `aisha_tooling_proposals.artifact_content` |
| Schválený + committed artefakt | Crosses seam → OSS | `.claude/{skills,hooks,commands}/` přes Forgejo PR |

**Invariant:** proprietární expertní znalost (Tier 1/2) se **NIKDY** necommitne do public OSS
seedu (`seed/core|demo`). Jde výhradně do `seed/instance/` (`AISHA_SEED_PROFILE=instance`) nebo
na live DB. OSS repo si zachovává plně funkční base smyčku.

---

## 14. Automatizovaná aktivace (parametricky, nic hardcoded)

Aktivace 5 workflows je plně automatická součást cold-startu — **žádný manuální krok, žádná
hardcoded hodnota**, a **secrets nejsou plaintext `$env` v běžícím n8n** (jsou v šifrovaném
n8n credential store). Řetězec:

```
aisha-cold-start.sh
  → coolify-deploy-init.sh (orchestration blok): push kanonických app env vars na n8n app
  → docker-compose.coolify-n8n.yml:
      ├─ n8n + n8n-worker: passthrough ${VAR:-} jen NESECRET routing vars (URLs, webhook)
      └─ n8n-workflow-init (transient): + 2 bootstrap secrets (FORGEJO_API_TOKEN, ANTHROPIC_API_KEY)
  → n8n-workflow-init → deploy-workflows.mjs:
      ├─ ensureSelfToolingCredentials() — vytvoří 3 šifrované n8n credentials z env:
      │     'AISHA PostgREST' (aishaPostgrestApi), 'Forgejo API' + 'Anthropic API' (httpHeaderAuth)
      ├─ glob n8n/workflows/*.json (5 self-tooling se naberou samy, žádný manifest)
      ├─ remap __REMAP__ → reálné credential id (by name)
      └─ activate (cron + webhooks)
```

**Secret model (security-best):** committer/factories autentizují přes **šifrovaný n8n
credential store**, NE přes `$env`. Long-running `n8n`/`n8n-worker` drží **nula** self-tooling
secrets. Hodnoty se čtou **jen jednou** v transient `n8n-workflow-init` pro vytvoření credentials
(z +6 always-on plaintext → +2 transient + encrypted-at-rest).

| Tajemství | Jak | Kde |
|---|---|---|
| Forgejo token | n8n credential `Forgejo API` (httpHeaderAuth `Authorization: token …`) | encrypted store; bootstrap value jen v transient init |
| Anthropic key | n8n credential `Anthropic API` (httpHeaderAuth `x-api-key`) | encrypted store; bootstrap value jen v transient init |
| PostgREST service key | committer **reuse `$env.AISHA_SERVICE_KEY`** (už wired, žádný nový secret) | existing n8n env |

**Parameter mapping** (NESECRET routing vars; `$env.X` ← kanonický zdroj, derivace v orchestration shellu, NE hardcode):

| Workflow `$env.X` | Kanonický zdroj | Vrstva |
|---|---|---|
| `AISHA_POSTGREST_URL` | `${AISHA_API_URL}` | orchestration push + compose passthrough |
| `N8N_WEBHOOK_URL` | `${N8N_WEBHOOK_URL}` (z N8N_DOMAIN, topology resolver) | orchestration push + passthrough |
| `FORGEJO_API_URL` / `FORGEJO_OWNER` / `FORGEJO_REPO` | `${FORGEJO_API_URL:-${FORGEJO_URL}}` atd. | orchestration push (soft) + passthrough |
| `ANTHROPIC_API_URL` / `FORGEJO_DEFAULT_ASSIGNEE` | — (in-workflow fallback) | optional |

**Vynuceno:** `aisha-self-tooling.gate.test.ts` §9 ověřuje, že workflows **NEčtou** secret `$env`,
že factories/committer používají credentials, že long-running n8n/worker drží ≤1 secret deklaraci
(jen transient bootstrap), a že deploy-workflows mintuje 3 credentials. Plus ratchet
`wp-3-7-secrets` (baseline 274; +2 = ty 2 transient bootstrap secrets, viz `_note` v baseline).

> **Live-verify caveat:** statický gate ověřuje strukturu; runtime n8n credential chování +
> Coolify app-env→container injection se potvrdí při live `--wipe` deploy.
> **Pattern note:** +2 sleduje etablovaný stack pattern (`OPENAI_API_KEY`, `GOOGLE_AI_API_KEY` jsou
> rovněž compose-env primary + `app_secrets` vault override — viz `svc-ai-chat/openaiKey.ts`). Není
> to nový static debt. Pravé +0 = **vault-PRIMARY** migrace VŠECH provider secrets (cold-start
> populuje `app_secrets`, consumers čtou jen vault) — samostatná architektonická story pro celý
> stack, ne jen self-tooling.

### 14.1 Wipe / cold-reset bezpečnost (secret & cert flow)

| Aspekt | Chování při wipe / cold-reset |
|---|---|
| `FORGEJO_API_TOKEN`, `ANTHROPIC_API_KEY` | **operator BYOK** — `aisha-cold-start.sh` je čte z `.env-prod-backup` (`read_env_key`), **NEgenerují se**. Persistují přes wipe; orchestration je pushne na n8n app při každém startu. |
| n8n credentials (Forgejo/Anthropic/PostgREST) | **re-mintují se každý cold-start** — na čisté post-wipe n8n je credMap prázdná → `ensureCredential` vytvoří; jinak idempotentní skip (`if (credMap.has(name)) return`). |
| `N8N_ENCRYPTION_KEY` | v `REGEN_KEYS` (cold-start ho přegeneruje/zachová). Staré encrypted credentials zmizí s wiped n8n DB a mintnou se nové konzistentně novým klíčem — bez ručního zásahu. |
| Generated secrets (hesla, certy, klíče) | regenerují se cold-startem (`generator pushes creds` invariant); reference v compose se nemění. |

**Baseline je wipe-stabilní:** `wp-3-7-secrets` počítá `${VAR}` **reference** ve statických compose
YAML (git), **ne hodnoty**. Wipe regeneruje hodnoty, ne reference → baseline se wipem nemění. Drift
`perFile` (keycloak/langfuse) v committed baseline pochází z **commitů editujících compose** (ne z
wipe); proto je zápis v tomto PR zúžen jen na `n8n +2` a cizí stale perFile se nedotýká (gate
kontroluje **total**). Pozn.: total může maskovat per-file nárůst (keycloak +1 ofsetnut langfuse −2)
— pre-existing slabina ratchetu, follow-up mimo tento PR.
