# Zadání — Scaffold nového work-package

Vytvoř nové delegovatelné zadání (work-package) podle šablony DELEGATION_PLAN.

## Arguments: $ARGUMENTS

## Instructions

1. **Zjisti další volné číslo**: `ls docs/planning/zadani/WP-*.md` a vezmi nejvyšší číslo + 1 (formát `WP-NN`).

2. **Parsuj argumenty**: `$ARGUMENTS` obsahuje krátký popis úkolu, volitelně fázi/modul MASTER_PLANu (např. „Fáze 7 M5") a tier (`A`/`B`/`C`). Pokud tier chybí, odvoď ho z DELEGATION_PLAN §3:
   - RPC `SECURITY DEFINER` / RLS / auth / migrace baseline / architektura / diagnostika produkce → **A**
   - dobře specifikovaná implementace (edge fn, n8n WF, UI hooky, testy, i18n) → **B**
   - mechanické edity → **C**

3. **Zkopíruj šablonu**: `docs/planning/zadani/_TEMPLATE.md` → `docs/planning/zadani/WP-NN-<slug>.md` (slug z popisu, kebab-case, anglicky).

4. **Vyplň všechna pole** podle hloubky vzoru `docs/planning/zadani/WP-04-proactive-activation.md`:
   - Metadata (ID, plan-linkage na MASTER_PLAN/AI_AGENT_ROADMAP, tier, slot profil, závislosti, approval)
   - Kontext s **reálnými, ověřenými** cestami (každou ověř přes `ls`/Glob — nikdy nevymýšlej)
   - In-scope / OUT-of-scope explicitně
   - Dotčené kontrakty (RPC/route/exporty) + versioning note
   - Required skills z `.claude/skills/` (`ls .claude/skills/`)
   - DoD s reálnými gate příkazy z package.json
   - Verifikace chování (konkrétní kroky, ne jen „gates zelené")
   - Eskalační triggery dle DELEGATION_PLAN §3

5. **Aktualizuj backlog**: přidej řádek do tabulky §5 v `docs/planning/DELEGATION_PLAN.md`.

6. **Human-in-the-loop**: pokud je WP Tier A, nebo se dotýká LLM volání / notifikací / self-modifikace, nastav Approval: Ano a připomeň uživateli, že zadání čeká na jeho podpis.
