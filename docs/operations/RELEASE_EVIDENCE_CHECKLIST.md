# Release Evidence Checklist

Tento checklist definuje minimalni evidence balicek pro kazdy release.

## Povinne artefakty
- `docs/db-structure/gates-test-report.json`
- `docs/db-structure/access-flow-report.json` (pokud security/db change)
- `docs/db-structure/source-truth-report.json` (pokud security/db change)
- build status (success/failure)
- commit SHA a timestamp release

## Povinne quality signaly
- TypeScript bez chyb
- ESLint bez chyb
- Gate testy pass
- Build pass

## Governance signaly
- governance-gate result: success nebo skipped
- n8n workflow validation (pokud zmena v `n8n/workflows/`)

## Release verdict
- PASS: vsechny povinne signaly green
- CONDITIONAL: release pouze po explicitnim schvaleni ownera
- FAIL: deploy blokovany

## Audit trail
- Evidence artifact musi byt ulozen jako CI artifact s SHA suffixem
- Incident nebo vyjimka musi byt zapsana do `docs/incidents/`
