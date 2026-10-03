# Story Onboarding How-To

> Jak onboardovat nový projekt do AISHA platformy — kompletní průvodce.
> Výsledek: projekt má story, expert rules, ruleset, KB items, IDE instrukce.

## Přehled procesu

```
Analýza repo → Definice rules → Seed produkce → Download payload → IDE soubory → .aisha/ config → Seed SQL
```

| Krok | Vstup | Výstup | Čas |
|------|-------|--------|-----|
| 1. Analýza | Git repo | Tech stack, architektura, patterns | 10–30 min |
| 2. Story metadata | Analýza | partner_stories záznam | 2 min |
| 3. Expert rules | Analýza + domain znalost | 4–10 expert_rules | 20–60 min |
| 4. Seed produkce | Rules + story | Nasazeno na AISHA backend | 2 min |
| 5. Payload download | Produkční data | .aisha/instruction-payload.json | 1 min |
| 6. IDE soubory | Payload | copilot-instructions.md, AGENTS.md, CLAUDE.md | 1 min |
| 7. .aisha/ config | Story ID | story.json, dirigent.json, session.json | 2 min |
| 8. Seed SQL | Vše | Phase v seed.instance.sql | 5 min |

---

## Krok 1: Analýza repozitáře

Projdi strukturu projektu a identifikuj:

### 1a. Tech Stack
- **Jazyky**: TypeScript, Python, PHP, Java, ...
- **Frameworky**: React, Vue, Express, Nette, FastAPI, ...
- **Build tools**: Vite, Webpack, Ant, Composer, ...
- **Databáze**: PostgreSQL, MariaDB, SQLite, ...
- **Infrastruktura**: Docker, K8s, Coolify, ...

### 1b. Architektura
- Kolik vrstev/služeb?
- Jaký data flow?
- Klíčové moduly a jejich odpovědnosti?
- Existující testy a CI pipeline?

### 1c. Domain Knowledge
- Business doména (healthcare, gaming, CMS, ...)
- Klíčové entity a terminologie
- Specifické patterns (PHI handling, coordinate mapping, CMS editor, ...)

### 1d. Doporučený počet rules
- **Malý projekt** (1 služba, 1 framework): 4–6 rules
- **Střední projekt** (2–3 služby, multi-stack): 6–8 rules
- **Velký projekt** (microservices, 4+ technologií): 8–12 rules

### 1e. Kategorie rules

| Kategorie | Kdy ji použít |
|-----------|--------------|
| `architecture_pattern` | Celková architektura, vrstvy, data flow |
| `coding_standard` | Frontend/backend konvence, TypeScript strict, linting |
| `devops_pipeline` | Docker, CI/CD, deployment, build scripty |
| `domain_knowledge` | Business terminologie, entity mapping, geo pravidla |
| `integration_pattern` | Propojení služeb, API clients, CMS editor, bridge |
| `security_practice` | Auth, RBAC, audit, data protection |
| `testing_strategy` | Test levels, mock policy, CI gates |
| `ai_prompt_engineering` | AI-specific patterns, NPC intelligence, LLM config |
| `project_management` | Migration strategy, legacy handling, release gates |

---

## Krok 2: Story Metadata

### project_preview (povinný tvar)

```json
{
  "summary": "Jednovětý popis projektu.",
  "goals": ["Cíl 1", "Cíl 2", "Cíl 3"],
  "constraints": ["Omezení 1", "Omezení 2"],
  "success_criteria": ["Kritérium 1", "Kritérium 2"]
}
```

> ⚠️ Všechny 4 klíče jsou povinné (DB check constraint `partner_stories_project_preview_shape_check`).

### partner_stories INSERT

```sql
INSERT INTO partner_stories (
  id, partner_id, user_id, title, status, priority,
  tech_stack, risk_profile, domain, repo_url, default_branch,
  project_preview
) VALUES (
  '<story-uuid>', '<partner-uuid>', '<user-uuid>',
  'Název projektu', 'active', 'high',
  ARRAY['typescript','react','...'],
  'low|medium|high',
  ARRAY['domain1','domain2'],
  'https://forgejo.example.com/org/repo', 'main',
  '{"summary":"...","goals":[...],"constraints":[...],"success_criteria":[...]}'::jsonb
);
```

---

## Krok 3: Expert Rules

Každé pravidlo má:

| Pole | Popis |
|------|-------|
| `slug` | Unikátní identifikátor: `{projekt}-{topic}` |
| `title` | Lidsky čitelný název |
| `summary` | 1–2 věty |
| `category` | Jedna z kategorií výše |
| `ai_instructions` | **Hlavní obsah** — co AI agent dostane jako kontext |
| `ai_context_tags` | Array tagů pro vyhledávání |
| `body_markdown` | Rozšířená dokumentace (volitelné) |

### Šablona ai_instructions

```
{Název} Rules:

Key principles:
- Pravidlo 1
- Pravidlo 2

Key modules:
- modul.ts — popis
- config.json — popis

Commands:
- npm run build — build
- npm test — testy

Anti-patterns:
- NIKDY nedělejte X
- VŽDY použijte Y
```

---

## Krok 4: Seed Script (Python)

Vytvořte `scripts/seed_{projekt}.py` — vzor v `docs/templates/story-template.md`.

Script musí:
1. Načíst `.env.aisha` s `VITE_AISHA_POSTGREST_URL` a `AISHA_POSTGREST_SERVICE_KEY`
2. Získat user token přes GoTrue magic link (`/auth/v1/admin/generate_link` → `/auth/v1/verify`)
3. Vytvořit story (`POST /rest/v1/partner_stories`)
4. Vytvořit rules přes RPC (`POST /rest/v1/rpc/create_expert_rule_audited` s user tokenem)
5. Publikovat rules (`PATCH /rest/v1/expert_rules?id=eq.{id}`)
6. Vytvořit ruleset (`POST /rest/v1/rpc/create_story_ruleset`)
7. Vytvořit KB items (`POST /rest/v1/knowledge_items`)

> ⚠️ `create_expert_rule_audited` vyžaduje **user JWT** (ne service_role) — audit trigger píše `auth.uid()`.

### Spuštění

```bash
cd /path/to/project
python3 scripts/seed_{projekt}.py
```

---

## Krok 5: Download Payload

```bash
python3 scripts/download_payload.py
# → .aisha/instruction-payload.json
```

Script stáhne story + ruleset + rules z produkce do lokálního JSON cache.

---

## Krok 6: IDE Soubory

```bash
python3 scripts/gen_ide_instructions.py
# → .github/copilot-instructions.md
# → AGENTS.md
# → CLAUDE.md
```

Generátor čte `.aisha/instruction-payload.json` a vytvoří 3 IDE-specifické soubory s:
- Kategorizovanými pravidly
- Project metadata
- PR checklist
- gen:metadata footer

---

## Krok 7: .aisha/ Konfigurace

### story.json
```json
{
  "story_id": "<story-uuid>",
  "updated_at": "2026-04-12T21:00:00.000Z"
}
```

### dirigent.json
```json
{
  "activeProfile": "production",
  "profiles": {
    "local": {
      "supabaseUrl": "http://127.0.0.1:57421",
      "anonKey": "<local-anon-key>"
    },
    "production": {
      "supabaseUrl": "https://api.aisha.guru"
    }
  },
  "expertiseLevel": "expert",
  "storyId": "<story-uuid>",
  "contextProfile": "repo_plus_rules",
  "autonomyMode": "hybrid"
}
```

### dirigent.local.json
```json
{
  "activeProfile": "production",
  "profiles": {
    "production": {
      "supabaseUrl": "https://api.aisha.guru",
      "anonKey": ""
    }
  },
  "ideAdapters": ["copilot", "agents", "claude"]
}
```

### session.json (aktualizuj storyId)
```json
{
  "storyId": "<story-uuid>",
  ...
}
```

---

## Krok 8: Seed SQL

Přidej novou Phase do `supabase/seed.instance.sql` pro reprodukovatelné dev/staging prostředí.
Použij `scripts/gen_seed_stories.py` jako generátor, nebo ručně podle vzoru existující Phase (např. Phase 4).

Struktura Phase:
1. `DO $$ DECLARE` s UUIDs
2. Story INSERT s `ON CONFLICT DO UPDATE`
3. Rules INSERT s `ON CONFLICT (slug) DO UPDATE`
4. Ruleset SELECT + INSERT s fingerprint
5. Story context binding

---

## Checklist

- [ ] Analýza provedena (tech stack, architektura, domain)
- [ ] Story UUID vygenerováno (`uuidgen | tr '[:upper:]' '[:lower:]'`)
- [ ] Expert rules definovány (4–12 dle velikosti)
- [ ] Seed script vytvořen a spuštěn na produkci
- [ ] Payload stažen do .aisha/instruction-payload.json
- [ ] IDE soubory vygenerovány (copilot-instructions.md, AGENTS.md, CLAUDE.md)
- [ ] .aisha/ nakonfigurováno (story.json, dirigent.json, dirigent.local.json)
- [ ] Seed SQL phase přidána do seed.instance.sql
- [ ] Dirigent extension se připojí a vidí story + rules

---

## Reference

- Templates: `docs/templates/story-template.md`
- Existing seeds: `supabase/seed.instance.sql` (Phase 1–7)
- Source onboarding: `docs/onboarding/SOURCE_APPLICATION_ONBOARDING_HANDBOOK.md`
- Enterprise contract: `docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md`
