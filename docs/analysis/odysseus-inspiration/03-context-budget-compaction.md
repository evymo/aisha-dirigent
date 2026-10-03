# Spec 03 — Adaptivní context budget + auto-kompakce historie

> **Priorita:** Vysoká · **Effort:** M (≈ 1–2 sprinty) · **Riziko:** Střední
> **Odysseus zdroj:** `src/context_budget.py`, `src/context_compactor.py`, `src/model_context.py` (clean-room návrhový vzor)

---

## 1. Problém

AISHA **trackuje token budget, ale nevynucuje ho**, a **nezná reálná context okna modelů** → riziko overflow u dlouhých konverzací a plýtvání u velkých oken.

Evidence (current state):
- `services/svc-ai-chat/src/lib/orchestrationBridge.ts` — `ContextBundle { tokenBudget, tokensUsed }`, reportuje se v patičce promptu (`tokens: ~X/Y`), ale **bez automatické truncation/sumarizace** při překročení.
- `modelDiscovery.ts` — `DerivedModelCaps` **nemá** `context_window` ani `max_tokens`/cost. Window se nediskvouje z provider API.
- `story-consult.ts` (~ř. 154) — historie hardcoded `.slice(-6)`.
- `chat.ts` (~ř. 446–464) — načítá **celou** historii z `get_chat_messages_audited`, předá LLM bez limitu → overflow na dlouhých konverzacích.
- Token counting heuristika `CHARS_PER_TOKEN = 4` (`knowledge-embeddings.ts`) — žádný skutečný tokenizer.
- Hippocampus `traitLimit = 12` — arbitrární, nenavázané na okno.

**Důsledek:** buď ořež příliš (hardcoded 6 zpráv ignoruje 128k okno), nebo málo (celá historie přeteče malé okno). Žádná adaptace na model.

---

## 2. Jak to řeší Odysseus (návrhový vzor)

`context_budget.py` — `compute_input_token_budget(configured, context_length, explicit, …)`:
- Odvodí efektivní budget z **reálného okna modelu**, ne fixní strop. Když user nenastavil explicitní budget, škáluje k oknu (s `headroom = 0.85`, `hard_max = 200k`). Když nastavil, respektuje (clamp na okno).
- `context_length = 0` (neznámé okno) → konzervativní fallback, netrustuje neověřené okno.
- Čistá, side-effect-free, unit-testovatelná funkce.

`context_compactor.py` — auto-kompakce při `COMPACT_THRESHOLD = 0.85` okna:
- Sumarizuje starší zprávy stejným LLM (`SUMMARY_MAX_TOKENS = 1024`), zachová klíčový kontext.
- `_content_as_text()` zvládá tři tvary obsahu (string / multimodal bloky / None u tool-call turnů).

`model_context.py` — `get_context_length()`, `estimate_tokens()` jako jeden zdroj pravdy o oknu modelu.

---

## 3. Best-practice cílový design pro AISHA (dynamický)

**Princip:** budget i kompakce odvozené z **model registry**, ne z per-profil konstant. Jeden zdroj pravdy o oknu modelu.

### 3.1 Discovery context okna (prerekvizit)
- Rozšířit `modelDiscovery.ts` / `ai_model_registry` o `context_window`, `max_output_tokens`, (volitelně cost). Parsovat z provider API (OpenAI `/v1/models`, Anthropic) nebo statická mapa pro self-hosted (vLLM Qwen3 = známé okno).
- Sdílí se se spec 01 (dynamické K) → stejný prerekvizit, udělat jednou.

### 3.2 Budget resolver
- `computeInputBudget(modelId, configured, explicit)` — čistá funkce á la Odysseus: auto-scale k oknu × headroom, respekt explicitního nastavení, konzervativní fallback při neznámém oknu.
- Nahradit per-profil `tokenBudget` číslo odvozenou hodnotou (profil může dál nastavit override = explicit cap).

### 3.3 Auto-kompakce
- Při `tokensUsed > threshold × window` sumarizovat nejstarší zprávy přes `aisha_resolve_clow_backend('chat'/'reasoning')` (reuse existující resolver, ne nový LLM call path).
- Zachovat: system, pinned ruleset, posledních N turnů; sumarizovat střed. Uložit sumarizaci do konverzace (auditovaně), ať se nepřepočítává.
- **Dynamičnost:** práh i kolik se sumarizuje = funkce okna a profilu, ne globální konstanta. Malý model (16k) kompaktuje agresivně, velký (128k+) skoro nikdy.

### 3.4 Přesnější token counting
- Přesnější token counting na hot-path. **Pozn. (ověřeno, viz impl/08-final-zadani §0):** `estimateTokens()` už existuje → **reuse**, žádná nová tokenizer dependency v nutném jádru; přesnější tokenizer (js-tiktoken) je volitelný deferred.

---

## 4. Scope

**In-scope:**
- `context_window` + `max_output_tokens` do model registry + discovery.
- `computeInputBudget()` čistá funkce + napojení do `orchestrationBridge`.
- Auto-kompakce staré historie (sumarizace) s perzistencí.
- Přesnější token counting na budgeting hot-path.
- Odstranění hardcoded `.slice(-6)` ve prospěch budget-driven trimu.

**Out-of-scope:**
- Plný redesign hippocampus memory (jen napojit `traitLimit` na budget místo konstanty 12).
- Cost-based routing (zajímavé, ale `aisha_resolve_clow_backend` to už částečně řeší — samostatně).
- Streaming-level token accounting (jen request-level budget).

---

## 5. Integrační body
- `services/svc-ai-chat/src/lib/modelDiscovery.ts` (+ `context_window`)
- `ai_model_registry` (DB schema — migrace)
- `services/svc-ai-chat/src/lib/orchestrationBridge.ts` (`ContextBundle`, assembly)
- `services/svc-ai-chat/src/routes/chat.ts` (history load — budget-driven)
- `services/svc-ai-chat/src/lib/hippocampus.ts` (`traitLimit` → budget)
- `aisha_resolve_clow_backend` (LLM pro sumarizaci)

## 6. Rizika
- **Ztráta kontextu** při sumarizaci → model „zapomene" detail. Mitigace: zachovat posledních N turnů + pinned obsah doslova; sumarizovat jen starý střed; uložit summary auditovaně.
- **Špatné okno z registry** → over/under-permit. Mitigace: konzervativní fallback při neznámém/neověřeném oknu (Odysseus `context_length = 0` vzor).
- **Tokenizer mismatch** u self-hosted modelů. Mitigace: bezpečnostní margin v aproximaci, headroom 0.85.
- **Latence** sumarizačního LLM callu. Mitigace: kompaktovat asynchronně / až při překročení prahu, cachovat výsledek.

## 7. Akceptační kritéria
- Dlouhá konverzace (> okno modelu) nepřeteče — request projde s kompakcí (integration test na malém okně).
- Budget pro 128k model je výrazně vyšší než pro 16k model (ne fixní per-profil číslo).
- Sumarizace zachová klíčové entity z ořezaných zpráv (eval na coherence).
- Neznámé okno → konzervativní budget, žádný overflow.
