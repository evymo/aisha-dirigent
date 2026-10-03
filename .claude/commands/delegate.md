# Delegate — Aktivace work-package pro delegovanou session

Aktivuj zadání (work-package) jako kontrakt této session. Určeno primárně pro nižší modely (Sonnet 5 / Haiku) přebírající práci dle DELEGATION_PLAN.

## Arguments: $ARGUMENTS

## Instructions

1. **Najdi zadání**: `$ARGUMENTS` obsahuje WP id (např. `WP-04`). Načti `docs/planning/zadani/WP-<id>-*.md`. Pokud neexistuje, vypiš dostupná zadání (`ls docs/planning/zadani/WP-*.md`) a skonči.

2. **Zkontroluj závislosti** (Metadata → Závislosti): pokud závislé WP nejsou hotové (ověř dle stavu v `docs/planning/DELEGATION_PLAN.md` §5, případně se zeptej uživatele), varuj a nech uživatele rozhodnout.

3. **Zapiš aktivní zadání** do `.aisha/zadani.json`:
   ```json
   {
     "wp_id": "WP-04",
     "file": "docs/planning/zadani/WP-04-proactive-activation.md",
     "tier": "B",
     "in_scope": ["<globy odvozené ze sekce §3 In-scope zadání>"],
     "activated_at": "<aktuální ISO timestamp>"
   }
   ```
   Tento soubor čtou advisory hooky `aisha-advise-tier-escalation` a `aisha-advise-zadani-scope`.

4. **Nastav slot profil** podle tieru (DELEGATION_PLAN §3): Tier A → `maxQuality`, Tier B → `balanced`, Tier C → `budget`. Použij postup z commandu `/aisha-router-config` (aktualizace `.aisha/dirigent.json`, lokálně).

5. **Načti required skills** ze sekce §5 zadání — přečti každý `.claude/skills/<name>/SKILL.md`, který zadání vyžaduje.

6. **Shrň kontrakt** uživateli: cíl, in/out scope, DoD, eskalační triggery — a potvrď, že session od teď pracuje výhradně v mezích zadání. Připomeň: `/zadani-verify` před handbackem; eskalace dle §9 = zastavit a zapsat handback poznámku, ne pokračovat.
