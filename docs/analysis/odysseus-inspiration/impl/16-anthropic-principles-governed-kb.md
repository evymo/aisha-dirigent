# Impl 16 — „Zná" AISHA Anthropic principy a chová se podle nich? + extrakce do governed KB

> Otázka: lze ověřit, že AISHA pracuje podle Anthropic best-practices (Basecamp), a zanést je tak, aby je **znala a vynucovala**? Odpověď: **aparát na to AISHA celý má** — jen do něj principy zatím nejsou nasypané a ověřené. Návrh: extrahovat je jako **governed rules přes vaši vlastní (povinnou) Source Onboarding cestu** + conformance ověření. Vše reuse.

---

## 1. Aparát, který už existuje (ověřeno)
AISHA má kompletní řetězec „governed knowledge → chování → atribuce → eval":
- **`expert_rules`** (slug, body_markdown, category enum, status, **`ai_instructions`**) — strojově vynutitelný rule store; `ai_instructions` = co s pravidlem AISHA dělá.
- **Knowledge ingestion:** `knowledge_items`→`knowledge_chunks`→`knowledge_embeddings`, `knowledge_moderation_queue` (governed), `agent_knowledge_sources/bindings`.
- **Source Onboarding Contract** (`docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md`) — **povinná 4-dim klasifikace** (source_type, data_sensitivity, retention_class, legal_basis) → `agent_knowledge_sources.config`; enforce `enterprise-source-hosting.gate.test.ts`.
- **CLAUDE.md overlay:** `scripts/generate-ide-instructions.mjs` + `ide-adapters/adapter-claude-overlay.mjs` generují CLAUDE.md z **AISHA Expert Overlay rulesetu** → behavioral contract na každý agent turn. (To je přesně Anthropic „CLAUDE.md" princip — už ho máte.)
- **`knowledge_attribution`** — trackuje, které rule/knowledge se použily (audit + revenue split).
- **`compose_context`** ruleset layer → pravidla tečou do každého runu (chat i reflection graf).
- **Dirigent** vyhodnocuje/koriguje agenty; `benchmarkRunner`/RAGAS = eval harness.

→ **Mechanismus „extrakce do KB → AISHA se podle toho chová → ověření" existuje celý.** Chybí: nasypat Anthropic principy jako rules + conformance check.

---

## 2. Mapa: Basecamp princip → stav v AISHE

| Princip (Basecamp) | AISHA dnes | Vynuceno kde |
|--------------------|-----------|--------------|
| **Model selection/routing (Haiku/Sonnet/Opus, start simple, escalate s důvodem)** | ✅ `aisha_resolve_clow_backend` (benchmark-scored per task_kind) | resolver |
| **Countermeasure stack před downgrade (caching/streaming/routing/effort)** | 🟠 částečně: routing ✅, streaming ✅, **caching ⚠️** (náš balík G1), effort ⚠️ (G3) | impl 10/14 |
| **Evals jsou load-bearing; eval před deploy/migrací** | 🟠 harness ✅ (`benchmarkRunner`/RAGAS), **eval-before-migration gate ⚠️** | G4 |
| **Context engineering (finite resource, progressive disclosure, compaction)** | 🟠 budget data tečou ✅, **enforce/kompakce ⚠️** (impl 03 chat / K1 graf) | 03 / G2 / K1 |
| **Progressive tool disclosure (ne všechny tooly najednou)** | 🟠 `toolsAllowlist` se počítá ✅, **neaplikuje ⚠️** | impl 01 |
| **Structured output (typed, ne parsovat odstavec)** | 🟠 `jsonMode` ✅ (openai), **Anthropic + grammar ⚠️** | G3-adjacent |
| **Safety as architecture (permission modes, hooks na destruktivní akce)** | ✅ agent-runner Docker izolace, fail-safe gates, SSRF; 🟠 explicitní PreToolUse hook konvence | 05A + agent-runner |
| **Diagnostic loop (system prompt + failures než měnit model)** | ⚠️ není jako vynucené pravidlo | nový rule |
| **Sessions/resumption/forking pro dlouhé běhy** | ✅ reflection checkpointing (`RunCheckpoint`, resume/`waiting_batch`); 🟠 forking ne | orchestrator |
| **MCP vs API rozhodnutí** | ✅ obě cesty (svc-mcp-knowledge + Messages API) | operating model (13) |
| **Simplicity wins / compose don't stack** | ✅ augmented-LLM-first, tři úrovně | 13 |
| **Calibrated uncertainty (model flaguje „nevím")** | ✅ Sonnet honesty + RAGAS faithfulness gate | judges |
| **No-train-on-data / VPC / governance** | ✅ self-hosted, residency, audit, RBAC | platforma |

**Závěr:** AISHA **už strukturálně dělá** většinu (model governance, safety, sessions, MCP/API, simplicity, governance). „Měkké" principy (diagnostic loop, countermeasure-before-downgrade, eval-before-migration, progressive disclosure) jsou částečně a hlavně **nejsou kodifikované jako vynutitelná pravidla** → nelze je auditovat.

---

## 3. Návrh: extrakce do governed KB (přes vaši povinnou cestu)

### 3.1 Onboard jako governed source (NE ad-hoc)
„**Anthropic Operating Principles**" projít **Source Onboarding Contract**:
- klasifikace: `source_type=external`, `data_sensitivity=public`, `retention_class=long_term`, `legal_basis=legitimate_interest` → `agent_knowledge_sources.config`.
- ingest přes `knowledge_items` → moderation queue → chunks/embeddings (ingestion-safety platí).
- projde `enterprise-source-hosting.gate.test.ts` (jinak se neaktivuje).

### 3.2 Destilovat do `expert_rules` (strojově vynutitelné)
Každý princip = řádek `expert_rules` se slugem + **`ai_instructions`** (vynutitelná direktiva), např.:
| slug | ai_instructions (zkráceně) | category |
|------|----------------------------|----------|
| `eval-before-model-migration` | „Změna default modelu vyžaduje green eval set; jinak blokuj." | governance |
| `countermeasure-before-downgrade` | „Před návrhem levnějšího modelu vyčerpej caching/streaming/routing/effort." | cost |
| `diagnose-before-model-swap` | „Při ‚AI nefunguje' vyžádej system prompt + posledních 10 failů před změnou modelu." | diagnostics |
| `context-as-finite-resource` | „Surface tooly/kontext progresivně; kompaktuj nad prahem; netahej vše najednou." | context |
| `safety-hook-on-destructive` | „Destruktivní tool akce musí projít PreToolUse hookem/permission gate." | safety |
| `typed-output-for-pipelines` | „Strukturovaný výstup (schema), ne parsování odstavce, kde výstup konzumuje systém." | output |

→ tyto rules tečou do `compose_context` ruleset layer (chat i graf) **a** do CLAUDE.md overlay (`generate-ide-instructions`) → **každý agent turn je zná.** `knowledge_attribution` zaznamená použití.

### 3.3 Napojení na existující plán (aby „chování" bylo reálné, ne jen text)
Pravidlo bez vynucení je jen text. Každé klíčové pravidlo má **technický enforcement** z našeho plánu:
- `eval-before-model-migration` → **G4 gate** (impl 14).
- `countermeasure-before-downgrade` → caching (G1) + streaming + resolver routing + effort (G3).
- `context-as-finite-resource` → impl 03 + G2/K1 (kompakce na node boundary).
- progressive tool disclosure → impl 01 (wire toolsAllowlist).
- typed-output → structured output (G3-adjacent).
- safety-hook → 05A + agent-runner permission modes.
→ **rule (KB) + enforcement (kód) + atribuce (audit) = AISHA princip skutečně zná i vynucuje.**

---

## 4. Ověření „že tak pracujeme" (conformance)
Tři vrstvy důkazu — vše reuse:
1. **Conformance eval suite** (reuse `benchmarkRunner` + RAGAS judges): scénáře, které testují chování proti principům (např. „požádá o system prompt než navrhne jiný model?", „aplikoval countermeasure stack?", „existuje eval před deploy?"). LLM-as-judge + rule-based grader (vzor z Basecampu: exact/rule/judge).
2. **Gate** `anthropic-principles-conformance.gate.test.ts` (rodina k `security.gate`): assertuje, že enforcement-y existují (G4 gate aktivní, caching cesta, compaction hook, toolsAllowlist aplikován). Statické, levné.
3. **`knowledge_attribution` jako runtime důkaz:** které principy se v reálných runech použily → měřitelné, ne dojem. (Sedí i na váš revenue knowledge-split.)

---

## 5. Scope / effort
- **Obsah (governance):** sepsat principy → onboard jako source → destilovat do `expert_rules`. Žádný nový kód, jen data přes existující pipeline. **Hlavní práce = kurátorství pravidel.**
- **Kód:** 1 conformance gate + conformance eval scénáře (reuse harness). XS–S.
- **Enforcement:** už je v plánu (G1/G3/G4/01/03/05A) — tahle položka jen pravidla **kodifikuje a ověří**, neimplementuje je znovu.

## 6. Zařazení do plánu
- **Krok 2c** (po warm config/purposes, vedle G4 eval-gate): onboard `expert_rules` „Anthropic Operating Principles" + conformance gate (statický).
- Conformance **eval suite** běží průběžně (jako benchmarky), aktualizovat při změně modelů/principů.

> Pointa: nemusíme stavět nic nového, aby AISHA „znala" Anthropic principy — **použijeme vaši vlastní governance cestu** (Source Onboarding → expert_rules → compose_context/CLAUDE.md overlay → Dirigent → attribution) a doplníme **conformance gate + eval**, který dokazuje, že se podle nich chová. Pravidla bez technického enforcementu (už v plánu) by byla jen text — proto je vážeme 1:1 na konkrétní impl položky.
