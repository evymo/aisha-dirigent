---
name: aisha-delegation
description: Tiered delegace práce na modely (Fable 5/Opus 4.8 = Tier A, Sonnet 5 = Tier B, Haiku = Tier C) podle DELEGATION_PLAN — práce se zadáním (work-package kontrakt), aktivní zadání v .aisha/zadani.json, eskalační pravidla, Definition of Done, handback. Use when starting a delegated session, picking up a work package, escalating out-of-tier work, or verifying DoD before handback. Triggers on "zadání", "delegace", "work package", "WP-", "tier", "eskalace", "handback", "delegate", "zadani".
---

# AISHA Delegation Skill

Tento skill definuje, jak v tomto repu funguje **delegace práce mezi modelovými tiery**. Zdroj pravdy je `docs/planning/DELEGATION_PLAN.md` (schváleno 2026-07-01); tento skill je jeho operační výtah pro delegovanou session.

## Kdy to platí

| Scénář | Použij tento skill |
|---|---|
| Session přebírá work-package (`/delegate WP-XX`) | **Ano** |
| Ověření DoD před handbackem (`/zadani-verify`) | **Ano** |
| Rozhodnutí, zda je úkol Tier A/B/C | **Ano** |
| Tvorba nového zadání | **Ano** — přes `/zadani-new` |
| Ladění slot routingu / cost profilů | **Ne** — viz `aisha-router-tuning` skill |
| Doménová práce (edge fn, RPC, n8n, …) | **Ne** — viz required skills daného zadání |

## Tiery (DELEGATION_PLAN §3)

| Tier | Modely | Slot profil | Třída práce |
|------|--------|-------------|-------------|
| **A** | Fable 5, Opus 4.8 | `maxQuality` | Architektura, cross-service refaktory, **RPC `SECURITY DEFINER` / RLS / auth**, migrace kolem baseline, diagnostika produkce, approval rozhodnutí |
| **B** | Sonnet 5 | `balanced` | Dobře specifikovaná implementace ze zadání: edge fn, n8n WF, UI hooky, testy, i18n, mechanické migrace se SoT párem |
| **C** | Haiku 4.5 | `budget` | Triviální edity: formátování, i18n propagace, odkazy, changelog |

## Životní cyklus zadání

```
/zadani-new → APPROVED backlog (docs/planning/zadani/WP-*.md)
  → /delegate WP-XX  (zapíše .aisha/zadani.json, nastaví slot profil, načte skills)
    → práce V MEZÍCH kontraktu (§3 scope zadání)
      → /zadani-verify  (DoD gates + verifikace chování §8)
        → handback (§10: branch, PR, shrnutí, výsledky verifikace)
```

### `.aisha/zadani.json` — aktivní zadání

```json
{
  "wp_id": "WP-04",
  "file": "docs/planning/zadani/WP-04-proactive-activation.md",
  "tier": "B",
  "in_scope": ["n8n/workflows/**", "docs/planning/zadani/WP-04*"],
  "activated_at": "2026-07-01T00:00:00Z"
}
```

Soubor čtou advisory hooky (`aisha-advise-tier-escalation.sh`, `aisha-advise-zadani-scope.sh` v `.claude/hooks/`). Bez něj hooky mlčí — netýkají se nedelegovaných sessions. Soubor je lokální stav session, **necommituje se** (obdoba `.aisha/story.json`).

## Eskalační pravidla (povinná pro Tier B/C)

Zastav se a eskaluj na Tier A, když:

1. Edit míří na **RPC `SECURITY DEFINER` / RLS / GRANT / migrace / auth vrstvu** (hook `aisha-advise-tier-escalation` to připomene).
2. Práce vyžaduje **změnu veřejného kontraktu** — RPC signatura, route Zod schema, exportovaný typ package (hook `aisha-advise-contract-change`).
3. **Gate selže z netriviální příčiny** (`npm run test:gates`, `npm run build`, `npx tsc --noEmit`).
4. Scope se rozšiřuje **mimo in-scope globy** zadání (hook `aisha-advise-zadani-scope`).
5. Zadání je nejednoznačné — nikdy nedomýšlej kontrakt, ptej se / eskaluj.

**Jak eskalovat:** nezanech rozpracované změny bez záznamu. Zapiš do handback poznámky zadání (sekce §10): co je hotové, co je blokované a proč, jaké rozhodnutí Tier A potřebuje. Pak skonči.

## Pravidla práce v delegované session

- **Kontrakt je zákon** — OUT-of-scope sekce zadání je stejně závazná jako in-scope.
- **Advisory hooky respektuj** — jsou advisory-only, ale ignorovat je bez zdůvodnění je porušení kontraktu. Jediný tvrdý blok je `block-baseline-edit.sh` (baseline se NIKDY needituje přímo).
- **Gates nefalšuj** — fail reportuj jako fail; nikdy nekomentuj/neskipuj failing testy (CLAUDE.md: No Regressions).
- **Verifikace chování ≠ zelené gates** — sekce §8 zadání vyžaduje reálné ověření (spustit workflow, zavolat RPC, zkontrolovat audit řádek).
- **Malé commity** — `type(scope): popis`, jeden logický celek na commit.

## Gates (standardní DoD)

```bash
npm run test:gates      # vitest gates (AISHA_SKIP_ONLINE=1)
npm run build           # produkční build
npx tsc --noEmit        # typecheck
npx eslint <soubory>    # lint dotčených souborů
npm run i18n:check      # pokud dotčeny překlady (viz package.json i18n:*)
npm run func:validate   # pokud dotčeny DB funkce
```

Konkrétní podmnožinu určuje sekce §7 daného zadání.

## Související

- `docs/planning/DELEGATION_PLAN.md` — plný plán, backlog §5
- `docs/planning/zadani/_TEMPLATE.md` — šablona kontraktu
- Commands: `/delegate`, `/zadani-new`, `/zadani-verify`
- Skills: `aisha-router-tuning` (slot profily), doménové skills dle zadání
