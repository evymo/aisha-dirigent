# n8n Webhook Fix — Troubleshooting Guide

> **Problém:** Všechny webhooky na `n8n.aisha.guru` vrací `404 — not registered`.
> Žádná webhook-triggered execution nikdy neproběhla. Cron trigger funguje.
> **Datum diagnostiky:** 2026-03-05

## Diagnóza

| Test | Výsledek |
|------|----------|
| `/healthz` | ✅ `{"status":"ok"}` |
| `/api/v1/workflows` (API key) | ✅ Funguje |
| `/webhook/dirigent-agent` | ❌ 404 "not registered" |
| `/webhook-test/dirigent-agent` | ❌ 404 "not registered" |
| `/webhook/{workflowId}/chat` | ❌ 404 "not registered" |
| Workflow `active: true` | ✅ Ano (API potvrzuje) |
| Deactivate/Activate cycle | ❌ Nepomáhá |
| Total executions | 1 (Nightly Audit cron, error) |
| Webhook executions | **0 (nikdy)** |

**n8n verze:** 2.1.5 (z meta tag `n8n:config:sentry`)

## Root Cause

n8n vrací webhook 404 přesto, že workflow je `active: true`. To znamená, že **webhook manager** na n8n procesu nemá zaregistrované žádné webhooky.

Nejvíce pravděpodobné příčiny:

### 1. Chybí `WEBHOOK_URL` environment variable (nejpravděpodobnější)

V Queue Mode n8n **vyžaduje** `WEBHOOK_URL` pro registraci produkčních webhooků.
Bez tohoto env var n8n neví, na jaké URL webhooky vystavit.

**Fix:**
```
WEBHOOK_URL=https://n8n.aisha.guru/
```

### 2. n8n běží jako worker místo main procesu

V Queue Mode jsou dva typy procesů:
- `n8n` (main) — API + UI + **webhook handling**
- `n8n worker` — execution only

Pokud Coolify spouští `n8n worker` místo `n8n`, webhooky se neregistrují.

**Fix:** Ověřit startup command v Coolify. Musí být `n8n` (ne `n8n worker`).

### 3. n8n Scaling Mode (2.x) — chybí webhook proces

V n8n 2.x je nový "scaling" mode kde webhooky může zpracovávat separátní proces:
- `n8n` (main) — orchestrace
- `n8n webhook` — webhook handling
- `n8n worker` — execution

Pokud je scaling mode aktivní bez webhook procesu, webhooky nefungují.

**Fix:** Buď spustit `n8n webhook` proces, nebo nastavit `N8N_DISABLE_PRODUCTION_MAIN_PROCESS=false`.

## Postup opravy na Coolify

### Step 1: Zkontrolovat environment variables

V Coolify UI → n8n service → Environment:

```env
# POVINNÉ pro webhooky:
WEBHOOK_URL=https://n8n.aisha.guru/
N8N_HOST=0.0.0.0
N8N_PORT=5678
N8N_PROTOCOL=https

# Queue Mode:
EXECUTIONS_MODE=queue
QUEUE_BULL_REDIS_HOST=redis
QUEUE_BULL_REDIS_PORT=6379

# Doporučené:
N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN=true
GENERIC_TIMEZONE=Europe/Prague
```

### Step 2: Ověřit startup command

Coolify → n8n service → Settings → Start Command:
- ✅ Správně: `n8n` nebo `n8n start`
- ❌ Špatně: `n8n worker`

### Step 3: Restart n8n

Po změně env vars restartovat n8n kontejner v Coolify.
Webhook registrace proběhne při startu n8n.

### Step 4: Ověření

```bash
# Spustit diagnostiku:
npm run aisha:webhooks:test

# Nebo manuálně:
curl -X POST https://n8n.aisha.guru/webhook/dirigent-agent \
  -H "Content-Type: application/json" \
  -d '{"message":"health_check","session_id":"fix-verify"}'
```

Očekávaný výsledek: HTTP 200 s JSON odpovědí od Dirigent agenta.

### Step 5: Po opravě

```bash
# Deaktivovat a znovu aktivovat všechny workflow (reregistrace webhooků):
npm run aisha:prompts:deploy  # Includes deactivate/activate cycle

# Ověřit:
npm run aisha:webhooks:test
```

## Alternativní diagnostika

Pokud výše uvedené nepomůže:

1. **Zkontrolovat n8n logy v Coolify** — hledat "webhook" nebo "registration" chyby
2. **Zkontrolovat, zda Redis běží** — `redis-cli ping` v n8n kontejneru
3. **Zkontrolovat, kolik n8n kontejnerů běží** — měl by být 1x main + 1x worker (nebo jen 1x main pro single-process)
4. **Ověřit Traefik routing** — webhooky musí jít na main process, ne na worker

## Dočasný workaround (pokud webhook fix trvá déle)

Pokud oprava na Coolify potrvá, alternativní přístup:

1. **Polling-based trigger** — nový n8n workflow s Schedule triggerem, který polluje Supabase tabulku `aisha_signal_queue`
2. **Direct n8n internal execution** — Execute Workflow node z cron-triggered workflow

Tyto workaroundy přidávají latenci (10-60 sekund) a nejsou doporučeny pro produkci.
