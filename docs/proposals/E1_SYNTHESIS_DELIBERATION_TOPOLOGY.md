# E1 — Synthesis (fusion) node + deliberation topology

> **Status:** částečně implementováno / návrh pro navazující fúzi. E1.x-a pure kernel
> (`planDeliberation`, `prepareFusion`) i ToT v1 sibling nody/graf už jsou na `main`;
> `tot_synthesize` a champion/challenger gate zůstávají backlog. Aditivní rozšíření
> nad `TREE_OF_THOUGHTS_REFLECTION.md` a `AISHA_ORCHESTRATION_MASTERPLAN.md`.
> **Datum:** 2026-06-20. **Sync:** 2026-06-21 proti `origin/main`.

## 0. TL;DR

Tzv. **council** (N levných modelů draftuje paralelně → 1 frontier model je *fúzuje*)
**není nový subsystém** — je to **topologie/lens** nad primitivy, které už máme nebo
plánujeme (Soulforge sloty, `unifiedChat` fan-out, `critic`, `ai_decisions` journal,
champion/challenger). Toto rozšíření přidává přesně **dvě** chybějící věci:

1. **Fúzní krok jako first-class uzel** evaluation-grafu — `tot_synthesize`. Náš dnešní
   `critic` *skóruje jeden draft* a ToT search *vybírá větev*; ani jedno **neslučuje** N
   odpovědí do jedné lepší. Fúze (najdi shody / rozpory / co každá vynechala → napiš
   jednu sloučenou) je ta jediná reálně nová myšlenka z triku.
2. **„Deliberation topology" jako osa rozhodnutí** — `single | panel_fuse | tree` — kterou
   emituje resolver/admission podle **prahu hodnoty a rizika** („vyplatil by se ti premium
   model? → je to council-otázka"). Default je **`single`**; fan-out je gateovaná výjimka.

## 1. Závislosti a hranice (NEDUPLIKOVAT)

Toto rozšíření **stojí na E0** a E0 **neimplementuje znovu**:

| Komponenta | Vlastník | Kde žije | Tento doc |
|---|---|---|---|
| `AishaExecutionDecision` SoT (`reflection/decision.ts`) | E0 | `main` | jen **rozšiřuje** o osu `deliberation`, neredefuje |
| `ai_decisions` journal + `fn_record_execution_decision` | E0 | `main` | zapisuje `deliberation` plán do `reason` / nového sloupce |
| Admission (`fn_admit_clow`, `fn_compute_clow_risk`) | E0.5 | `main` | dodává vstupy `riskLevel`, budgety |
| `ai_decisions` / ZADANI / MASTERPLAN docs | E0 | `AISHA_ORCHESTRATION_ZADANI.md` (E0-only) | reference, ne kopie |
| ToT v1 nody (`tot_planner/expand/evaluate/search`) | E1 | `main` (`services/svc-ai-chat/src/reflection/nodes/*`) | `tot_synthesize` je jejich **sourozenec** |

**Sync 2026-06-21:** E0 worktree splynul do `main`; ToT v1 nody i `reasoning-tree-reflect`
jsou součástí aktuální větve. Navazující práce proto nesmí tvrdit, že E0/ToT jsou jen
branch-only návrh. Integrace nové osy `deliberation` do `decision.ts` zůstává samostatný
budoucí krok, protože dnešní E1.x-a pure kernel zatím pouze sizing/fusion plánuje.

**Schema alignment s E0 (ověřeno čtením E0 `decision.ts`):** osy `AishaExecutionDecisionSchema`
jsou **snake_case Zod** (`runtime`, `backend_kind`, `strategy: sync|batch`,
`risk_level: low|medium|high|critical`, `admission_verdict: allow|ask|deny`). Budoucí E1.x-b
proto přidá osu jako **sub-objekt `deliberation`** v tomto stylu — `topology: single|panel_fuse|tree`
(po vzoru `strategy`), `fanout: int` — a **znovupoužije** existující `risk_level` a `admission_verdict`
jako vstupy `planDeliberation()` (žádné paralelní enumy). Interní TS helper zůstává camelCase;
na hranici SoT se mapuje na snake_case pole. Tím je merge s E0 bezešvý.

## 2. Efektivita „z podstaty návrhu" (proč to nezdraží provoz)

Council je na běžném provozu **regrese ceny i latence** (soudce je pořád frontier + platíš
N panel-callů + přidaná latence). Proto je celý návrh postavený na levném, **pure**
rozhodnutí *před* jakýmkoli fan-outem. To rozhodnutí je `planDeliberation()`
(`reflection/deliberation/planDeliberation.ts`). Jeho invarianty (vynucené unit testy):

- **DEFAULT topology = `single`.** Eskalace je výjimka, ne norma.
- **Na interaktivním hot-path (`unifiedChat`) se NIKDY nefanoutuje** — uživatel čeká.
- **Urgentní úkol** (deadline pod prahem slacku) → `single`.
- **Threshold otázka:** fan-out jen když `highStakes || risk ∈ {high, critical}`.
- **Nikdy nepřekročit rozpočet:** když ani `MIN_FANOUT` (=2) nevejde do `min(zbývající budget, per-task strop)`, degraduj na `single`. Premium soudce se účtuje přes `judgeCostRatio`.
- **`maxFanout = 1` deliberaci úplně vypne** (policy kill-switch, bez kódové změny).

Fúzní krok má vlastní pure guard `prepareFusion()`: dedup identických draftů + cap panelu,
aby se soudci neplatily tokeny za reconciliaci duplikátů (reálné riziko, když levné modely
konvergují); při jediném distinct kandidátu = **passthrough**, žádná fúze.

## 3. Akceptační kritérium = champion/challenger (POVINNÉ, ne A/B opt-in)

Čísla z marketingu triku (jeden benchmark, bez rozptylu) **nejsou důkaz**. `panel_fuse`/`tree`
se smí stát defaultem pro jakoukoli třídu úloh **až** poté, co náš **champion/challenger**
plán (mandatory central feedback plane, viz ZADANI §6.4 / MASTERPLAN, Q5) na **našich**
úlohách prokáže, že fúze bije nejlepší single-shot **při započtené ceně a latenci**. Do té
doby je deliberation povolená jen jako explicitně vyžádaný mód na high-stakes async řezu.

## 4. Co se odmítá (a proč)

- **OpenRouter Fusion / Gavel (junkim100):** tvrdé NE. Posílají prompty mimo mesh přes třetí
  stranu, billing mimo `ai_spend`, a hlavně **bez `decision_id` / admission / audit journalu**
  → boří E0 tezi „no dispatch without a decision". Council stavíme **na vlastním LLM Gateway +
  Soulforge slotech + journalu**. (Též: porušuje OSS-only + no-infra-in-repo.)
- **Council jako „nová fíčura"/epocha:** odmítnuto. Je to `branching_factor>1` + fúzní uzel
  nad existujícími primitivy.

## 5. Story slotting (PR sekvence)

Nepřeřazuje E0→E1. Sloty:

- **E1.x-a** `planDeliberation` + `prepareFusion` (pure kernel + unit testy) — *hotovo na `main`.*
- **E1.x-b** osa `deliberation` na `decision.ts` (snake_case sub-objekt, viz §1 alignment; reuse `risk_level`/`admission_verdict`) + sloupec v `ai_decisions`.
- **E1.x-c** uzel `tot_synthesize` (LLM fúze; sourozenec `tot_evaluate`) — *ToT v1 už je na `main`, fúze ještě ne.*
- **E1.x-d** champion/challenger acceptance gate pro `panel_fuse`/`tree` — *povinné před defaultem.*

## 6. Testy / kontrola

- `services/svc-ai-chat/src/tests/reflection/deliberation.unit.test.ts` — logika kernelu (default-single, eskalace, affordability, dedup, validace).
- `services/svc-ai-chat/src/tests/reflection/deliberation-design.gate.test.ts` — **doc-invariant gate**: tento dokument nesmí tiše ztratit efektivitní invarianty ani deklaraci závislosti na E0 (anti-rot, ve stylu E0 „comment-aware" gates).
