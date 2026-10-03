# aisha-delegation — Claude Code plugin

Tiered delegation kit pro AISHA platformu. Distribuce artefaktů z [docs/planning/DELEGATION_PLAN.md](../../docs/planning/DELEGATION_PLAN.md) jako instalovatelný plugin.

## Co plugin obsahuje

| Komponenta | Soubory | Účel |
|------------|---------|------|
| **Skill** | `skills/aisha-delegation/SKILL.md` | Delegační proces — tiery, kontrakt zadání, eskalace, DoD |
| **Commands** | `commands/delegate.md`, `commands/zadani-new.md`, `commands/zadani-verify.md` | Aktivace WP, scaffold nového WP, verifikace DoD |
| **Hooks** | `hooks/hooks.json` + `hooks/aisha-advise-*.sh` | Advisory hooky: tier-escalation, zadani-scope, contract-change |

## Princip

- **Advisory-only**: hooky nikdy nedenymují akce — jen emitují doporučení (stejný princip jako AISHA Dirigent supervisor).
- **Aktivace přes `.aisha/zadani.json`**: hooky mlčí, dokud session nemá aktivní zadání (zapisuje `/delegate`). Nedelegované sessions plugin nijak neomezuje.
- **Tier policy** (DELEGATION_PLAN §3): Tier A = Fable 5 / Opus 4.8 (`maxQuality`), Tier B = Sonnet 5 (`balanced`), Tier C = Haiku (`budget`).

## Vztah k repo-lokálním artefaktům

Source of truth pro tento repozitář jsou ručně autorované soubory v `.claude/` (skills, hooks, commands) — plugin je jejich **zrcadlo pro distribuci** do dalších AISHA repozitářů. Při změně SoT synchronizuj kopie zde (`hooks/*.sh` jsou 1:1 kopie z `.claude/hooks/`, včetně `_aisha-advise-lib.sh`).

Plugin předpokládá AISHA repo konvence: `docs/planning/zadani/` (work-packages), `.aisha/` (session stav), `docs/planning/DELEGATION_PLAN.md`.

## Instalace

Plugin je registrován v `.claude-plugin/marketplace.json` tohoto repa (marketplace `evymo`). Instalace hooků skrze plugin je alternativou k ručnímu zapojení do `.claude/settings.json` (postup v DELEGATION_PLAN §6.2).
