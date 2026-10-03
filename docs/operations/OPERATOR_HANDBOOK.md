# Operator Handbook

Prakticky handbook pro operacni rizeni release, incidentu a governance flow.

## 1. Incident handling
- Krok 1: triage (severity, blast radius, impacted stack)
- Krok 2: containment (feature flag, route disable, workflow deactivate)
- Krok 3: mitigation (rollback, hotfix, traffic policy)
- Krok 4: evidence capture (CI artifact, logs, trace IDs)
- Krok 5: post-mortem v `docs/incidents/`

## 2. Approval and escalation flow
- HIGH/CRITICAL risk rozhodnuti musi projit approval gate
- Timeout approval -> `expired` stav + explicit escalation branch
- Escalation owner: staff/admin (Dirigent)

## 3. Knowledge gap handling
- Pokud retrieval quality failuje:
  - otevrit gap ticket,
  - doplnit knowledge item,
  - trigger reindex,
  - potvrdit zlepseni v metrikach.

## 4. Release operations checklist
- `npm run test:gates`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- verifikace release evidence artifactu

## 5. Stack rollback runbook
- Web: redeploy predchozi image/tag
- Core: rollback migrace podle policy + redeploy stacku
- Integration: restart connectoru + rollback config
- Admin: rollback compose revize
- n8n: deactivate vadny workflow + restore predchozi export

## 6. Communication protocol
- incident channel: #incident-room
- release owner hlasi stav kazdych 30 min
- po obnoveni sluzby povinne summary + action items

## 7. Upgrade už nasazené instance

Když compose nově vyžaduje klíč (`${KLÍČ:?…}`), instance nasazená před tou
změnou ho v Coolify env nemá. Které klíče to jsou a co udělat PŘED prvním
redeployem: [docs/deploy/UPGRADE_NASAZENE_INSTANCE.md](../deploy/UPGRADE_NASAZENE_INSTANCE.md).
