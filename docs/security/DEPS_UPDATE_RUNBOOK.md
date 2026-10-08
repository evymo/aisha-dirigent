# Dependency Update Runbook (vlastní updater místo Dependabota)

> Sesterský runbook k [CVE_RESPONSE_RUNBOOK.md](CVE_RESPONSE_RUNBOOK.md).
> Mechanismus: `scripts/aisha-deps-update.mjs` + `.github/workflows/aisha-deps-update.yml`
> Politika: `config/deps-policy.json`

## Proč vlastní updater (a ne Dependabot)

1. **Updater je forge-agnostický a běží i lokálně** — plán je obyčejný Node skript bez
   závislostí; PR zakládá přes GitHub REST API repa, které běží (`GITHUB_REPOSITORY`),
   nic se nedosazuje. Dependabot by běžel jen na GitHubu a jen nad svým seznamem.
2. **Ručně udržovaný seznam adresářů driftoval** — `dependabot.yml` nepokrýval 11 balíků
   (`observability`, `aitg`, `cache-redis`, `dirigent-core`, …), 6 služeb, dirigent extension
   ani `images/plugin-exec/shim`. Updater si cíle **odvozuje z `package-lock.json` souborů**
   (root workspace + standalone lockfile rooty) — nemůže driftovat.
3. **Verdaccio sekvencování** — interní `@aisha/*` balíky verzuje `aisha-packages-publish`.
   Dependabot principiálně neumí „nejdřív bump+republish interního balíku, pak konzumenti".
   Updater interní scope nikdy nebumpuje; **reportuje** drift (konzument resolvuje starší
   publikovanou verzi než workspace zdroj) → pořadí: merge bump balíku → publish → re-run sweep.

## Politika (config/deps-policy.json)

- **Jen minor + patch.** Major = bespoke PR po ruční kompatibilní kontrole (zrcadlí
  dependabot ignore pravidlo).
- Skupiny: `production` / `development` / `security` (audit nálezy ≥ `high` mají prioritu —
  náhrada za GitHub out-of-band security updates).
- `maxOpenPrs: 10` na sweep; větve `deps/<target>-<group>` (force-push na bot větve je
  standardní refresh pattern — NEvztahuje se na lidské PR větve, viz
  `feedback_pr_workflow_no_force`).
- Root `overrides` v package.json updater nikdy nemění.

## Fáze nasazení

| Fáze | Stav | Co se děje |
|------|------|-----------|
| 1 | **aktivní** | cron (Po 04:00 Praha) = DRY-RUN, plán v job logu — cron je OPT-IN (proměnná `DEPS_UPDATE_SCHEDULED=true`), ruční spuštění jde vždy |
| 2 | operátor | `workflow_dispatch` s `apply=true` pro dev/patch skupiny |
| 3 | po důvěře | apply jako cron default (edit workflow env `APPLY`) |
| 4 | finále | smazat `.github/dependabot.yml`, přepnout `npm-audit-services` z advisory na gating, aktualizovat `packages/security/src/index.ts` A06 komentář |

## Operace

```bash
# Lokální dry-run (plán bez PR)
node scripts/aisha-deps-update.mjs

# Jen jeden target
TARGET_FILTER=mobile-app node scripts/aisha-deps-update.mjs

# Otevřít PR (vyžaduje GITHUB_REPOSITORY=<vlastník>/<repo> a GITHUB_TOKEN v env)
APPLY=1 GITHUB_REPOSITORY=<vlastník>/<repo> GITHUB_TOKEN=<token> node scripts/aisha-deps-update.mjs
```

- PR jsou **idempotentní**: existující otevřený PR se stejnou head větví se aktualizuje,
  neduplikuje.
- V CI zakládá větev i PR `GITHUB_TOKEN` běhu — jenže na událost vyvolanou tímhle tokenem
  GitHub další workflow NESPUSTÍ, takže PR by zůstal bez CI. Secret `DEPS_UPDATE_TOKEN`
  (fine-grained PAT / token GitHub App s contents + pull-requests write) to řeší: když je
  nastavený, push i PR jdou pod ním a CI na PR poběží.
- Každý sweep posílá audit beacon do `audit_journal` přes `log_integration_action`
  (`p_service_name: 'github'`, soft-fail při výpadku).
- Instalace běží s `--ignore-scripts` (blokuje install-script supply-chain útoky) —
  stejná konvence jako CI.

## Troubleshooting

| Symptom | Příčina | Řešení |
|---------|---------|--------|
| `unsafe package name from registry metadata` | registry vrátila podezřelý název | NEpokračovat, prošetřit Verdaccio/upstream (možný supply-chain pokus) |
| interní `@aisha/*` drift warning | konzument resolvuje starší publikovanou verzi | merge bump balíku → `AISHA Packages Publish` → re-run sweep |
| PR creation failed 401/403 | `GITHUB_TOKEN` bez práva `pull-requests: write`, nebo `DEPS_UPDATE_TOKEN` expiroval | oprávnění workflow / obnovit secret v repo Settings → Secrets and variables → Actions |
| PR vznikl, ale CI na něm neběží | PR založil `GITHUB_TOKEN` | nastavit `DEPS_UPDATE_TOKEN` |
| sweep nenachází target | nový lockfile root mimo glob? | zkontrolovat `excludePathPatterns` v deps-policy.json |
