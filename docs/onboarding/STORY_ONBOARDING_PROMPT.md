# Story Onboarding Smart Prompt

> Chytrý hybrid prompt pro automatizovaný onboarding projektu do AISHA.
> Použití: Zkopíruj tento prompt do nové AI session, nahraď `{{ }}` proměnné.
> Výsledek: Kompletně nasazený AISHA story s rules, IDE soubory a konfigurací.

---

## Quick Start

1. Otevři novou AI session (Copilot, Claude, Codex)
2. Zkopíruj celý prompt níže
3. Nahraď `{{REPO_PATH}}` absolutní cestou k projektu
4. Spusť

---

## Prompt

```markdown
## Úkol: AISHA Story Onboarding

Proveď kompletní onboarding projektu na cestě `{{REPO_PATH}}` do AISHA platformy.
Postupuj přesně podle `docs/onboarding/STORY_ONBOARDING_HOWTO.md` v orchestrátoru
(kořen repa = `$(git rev-parse --show-toplevel)`).

### Kontext

- AISHA orchestrátor: kořen repa (`$(git rev-parse --show-toplevel)`)
- Env soubor: `.env.aisha` (v orchestrátoru, obsahuje VITE_AISHA_POSTGREST_URL a AISHA_POSTGREST_SERVICE_KEY)
- Produkční user: `<produkční účet — nastav lokálně, necommituj>`
- Partner ID: `<partner-uuid — set locally, do not commit>`
- User ID: `<user-uuid — set locally, do not commit>`
- Reference templates: `docs/templates/story-template.md`

### Fáze 1: Analýza (READ-ONLY)

1. Analyzuj `{{REPO_PATH}}` — projdi:
   - Kořenovou strukturu (package.json, composer.json, pom.xml, Dockerfile, ...)
   - Hlavní zdrojové adresáře (src/, app/, frontend/, backend/, ...)
   - Config soubory (tsconfig, vite.config, webpack, eslint, ...)
   - Existující testy a CI pipeline
   - README a dokumentaci
   
2. Identifikuj:
   - **Tech stack**: jazyky, frameworky, build tools, databáze, infra
   - **Architektura**: kolik vrstev/služeb, data flow, klíčové moduly
   - **Domain**: business doména, entity, terminologie
   - **Risk profile**: low/medium/high

3. Vypiš souhrn v tabulce:
   | Aspekt | Hodnota |
   |--------|---------|
   | Název projektu | ... |
   | Tech stack | [...] |
   | Architektura | ... vrstev |
   | Domain | [...] |
   | Risk profile | ... |
   | Doporučený počet rules | N |

4. Navrhni seznam expert rules (4–12 dle velikosti):
   - Pro každé rule: slug, title, category, 3–5 bullets co bude obsahovat

Počkej na mé potvrzení nebo úpravy.

### Fáze 2: Seed Script

Po potvrzení:

1. Vygeneruj `{{REPO_PATH}}/scripts/seed_{projekt}.py` podle vzoru:
   - Čti `.env.aisha` z orchestrátoru
   - GoTrue auth (magic link → verify → JWT)
   - Story INSERT s project_preview (summary, goals, constraints, success_criteria)
   - Rules přes `create_expert_rule_audited` RPC (vyžaduje user JWT!)
   - Publish rules (PATCH status=published)
   - Create ruleset (`create_story_ruleset` RPC)
   - KB items (3: overview, architecture decisions, project navigation)
   - Timeout 30s na všechny HTTP requesty
   - Existující story/rules = idempotent (ON CONFLICT)

2. Spusť seed:
   ```bash
   cd {{REPO_PATH}}
   python3 scripts/seed_{projekt}.py
   ```

3. Ověř výstup — všech 6+ kroků musí projít.

### Fáze 3: Payload + IDE soubory

1. Vytvořte `{{REPO_PATH}}/scripts/download_payload.py`:
   - Stáhne story + ruleset + rules z produkce
   - Uloží do `{{REPO_PATH}}/.aisha/instruction-payload.json`
   - POZOR: sloupec je `ruleset_fingerprint` (ne `fingerprint`), žádný `version` sloupec

2. Vytvořte `{{REPO_PATH}}/scripts/gen_ide_instructions.py`:
   - Čte payload JSON
   - Generuje 3 soubory: `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`
   - Každý obsahuje: projekt metadata, kategorizované rules, PR checklist

3. Spusťte oba:
   ```bash
   python3 scripts/download_payload.py
   python3 scripts/gen_ide_instructions.py
   ```

### Fáze 4: Konfigurace

1. Vytvořte `.aisha/story.json`:
   ```json
   {"story_id": "<story-uuid>", "updated_at": "<ISO-timestamp>"}
   ```

2. Vytvořte `.aisha/dirigent.json` s production profilem.

3. Vytvořte `.aisha/dirigent.local.json` s ideAdapters.

4. Aktualizujte `.aisha/session.json` — nastavte `storyId`.

### Fáze 5: Seed SQL + Template

1. V orchestrátoru přidejte novou Phase do `supabase/seed.instance.sql`:
   - Použijte `scripts/gen_seed_stories.py` jako generátor
   - Nebo ručně: DO $$ block s story + rules + ruleset + context

2. Vytvořte template v `docs/templates/story-template.md`:
   - Metadata tabulka
   - Rules tabulka (slug, title, category)
   - Architektura diagram (pokud víc než 2 vrstvy)
   - File tree
   - Build config
   - Replication steps

### Fáze 6: Verifikace

Ověřte:
- [ ] `python3 scripts/seed_{projekt}.py` — všechny kroky prošly
- [ ] `.aisha/instruction-payload.json` existuje a není prázdný
- [ ] `.github/copilot-instructions.md` — > 5000 chars
- [ ] `AGENTS.md` — > 5000 chars
- [ ] `CLAUDE.md` — > 5000 chars
- [ ] `.aisha/story.json` — obsahuje story_id
- [ ] `supabase/seed.instance.sql` — nová Phase přidána

### Výstupní report

Na konci vypiš:

```
AISHA Onboarding Report
========================
Project: {název}
Story ID: {uuid}
Ruleset ID: {uuid}
Rules: {N} (list slugs)
KB Items: {N}
IDE Files: 3 (copilot, agents, claude)
Seed SQL: Phase {N} added
Template: docs/templates/story-template.md
Status: ✅ Complete
```
```

---

## Proměnné

| Proměnná | Popis | Příklad |
|----------|-------|---------|
| `{{REPO_PATH}}` | Absolutní cesta k projektu | `~/projects/myproject` |

Všechny ostatní hodnoty (partner_id, user_id, AISHA URL) jsou fixní v promptu.

---

## Poznámky k implementaci

### Známé gotchas

1. **project_preview CHECK constraint**: Všechny 4 klíče povinné (summary, goals, constraints, success_criteria)
2. **Audit trigger**: `create_expert_rule_audited` RPC vyžaduje user JWT, ne service_role key
3. **SSL timeout**: Přidej `timeout=30` ke všem urllib/requests voláním
4. **Sloupec ruleset_fingerprint**: Ne `fingerprint`, ne `version` — sloupec se jmenuje `ruleset_fingerprint`
5. **KB items empty response**: POST vrací 201 s prázdným body — handle gracefully
6. **ALLOW_NEW_FILES**: Při commitu nových souborů nastav `ALLOW_NEW_FILES=1`

### Rozšíření promptu

Pro specifické projekty přidej do Fáze 1 sekci:

```markdown
### Specifické požadavky pro tento projekt

- Projekt používá {framework} — zahrň rule pro {pattern}
- Security vyžaduje {PHI/PII/GDPR} handling
- Multi-language UI → zahrň i18n rule
- Legacy kód → zahrň migration_strategy rule
```

---

## Příklady nasazení

| Projekt | Rules | Stack | Čas celkem |
|---------|-------|-------|------------|
| Example Story | 8 | PHP/Nette/Vue/TypeScript/Docker | ~45 min |
| Example Game | 8 | Java/Express/React/Python/Docker | ~45 min |
