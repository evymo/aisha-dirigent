# Blue-Green Deployment — návrh + implementační detail

> **Status:** Implementation in progress (Phase 2 of [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md))
> **Verze:** 2.0 (merged 2026-04-29)
>
> Document combines two converging design tracks:
> 1. **Capability audit + variant selection** (proč Variant A: 2 apps + Traefik labels)
> 2. **Implementation detail** (state mgmt přes coolify_app_slots, RPCs, switch protocol)
>
> Pokud čteš poprvé: začni Capability audit (níže). Pokud implementuješ:
> přejdi rovnou na "Část 2: Implementation Detail" (jak postavit konkrétní switch).

---

# Část 1: Capability audit + variant selection

# Blue-Green Deployment — návrh přes Coolify functionality

> Návrh, jak v AISHA stacku implementovat blue-green nasazení **bez vlastní
> orchestrace** — využijeme tovho, co Coolify v4 už umí.

## TL;DR

Coolify v4 **nemá native blue-green** (žádný "deploy strategy: rolling/canary").
Emulujeme přes pattern **dvě Coolify apps per stack + Traefik label switching**:

```
aisha-keycloak-blue    (router rule: Host(`auth.aisha.guru`))   ← LIVE
aisha-keycloak-green   (router rule: žádný — idle)
                              ↓ deploy + smoke test
aisha-keycloak-blue    (router rule: žádný — idle, fallback)
aisha-keycloak-green   (router rule: Host(`auth.aisha.guru`))   ← LIVE
```

Switch je `PATCH /applications/{uuid}` na env vars, které ovládají router rule.

---

## Co Coolify v4 poskytuje (audit)

| Capability | Coolify v4 | Použitelné? |
|---|---|---|
| Multiple deployments per app (history) | ✅ ano | ❌ jen audit, ne switching |
| Pre/post-deployment commands | ✅ ano | ✅ ano (smoke test, drain) |
| Health checks per service | ✅ ano (compose-defined) | ✅ ano |
| Force redeploy specific commit | ❌ ne | — |
| Git branch per app (PATCH-able) | ✅ ano | ✅ ano (varianta B) |
| Multiple servers per project | ✅ ano | ✅ ano (varianta C) |
| Traffic splitting / weighted routing | ❌ ne (jen Traefik labels) | — |
| Automatic rollback on health fail | ❌ ne | — |
| Blue-green native | ❌ ne | — |

Klíčové: Coolify deploy je atomic per-app, ale **mezi-app** orchestrace je naše
zodpovědnost.

---

## Tři varianty implementace

### Varianta A — Dvě apps, Traefik label switching (DOPORUČENO)

```
docker-compose.coolify-keycloak-blue.yml   → app aisha-keycloak-blue
docker-compose.coolify-keycloak-green.yml  → app aisha-keycloak-green
```

Identical compose, jen liší se v env vars:
- `BG_SLOT=blue` vs `BG_SLOT=green`
- `BG_ACTIVE_HOST=auth.aisha.guru` (jen na aktivním slot)
- Traefik router rule: `Host(\`${BG_ACTIVE_HOST}\`)` — pokud env var prázdná, router je no-op (Traefik se nezvedne pro tu app)

**Switch flow**:
1. Identifikuj currently active (přes Coolify API — který má `BG_ACTIVE_HOST` set)
2. Deploy alternate (idle):
   - PATCH env: `BG_ACTIVE_HOST=` (prázdná) — pojistka že nepřijde traffic
   - Trigger redeploy
   - Wait healthy
   - Smoke test (curl interní endpoint)
3. Switch:
   - PATCH alternate: `BG_ACTIVE_HOST=auth.aisha.guru`
   - Trigger redeploy alternate (Traefik picks up new router rule)
   - Wait alternate healthy
   - PATCH old active: `BG_ACTIVE_HOST=` (prázdná)
   - Trigger redeploy old active (Traefik drops router)
4. Old active je nyní "warm idle" (běží, ale neroutuje) — fallback pro rapid rollback

**Pros**:
- Žádný downtime
- Rollback je sub-second (jen PATCH env + redeploy)
- Old slot je warm (řekněme 30 minut po switch), žádný cold start při rollback

**Cons**:
- 2× počet apps (26 místo 13)
- Database/state se sdílí — blue i green mluví na stejnou aisha-db
- Schema migrations potřebují backwards-compat (oba slots běží během switch)

**Vhodné pro**: stateless apps (keycloak, n8n, web SPA, observability)

### Varianta B — Jeden app, switching git branch (NEDOPORUČENO pro production)

```
PATCH /applications/{uuid} { git_branch: "release-2026-04-28" }
POST /deploy?uuid=...
```

Jeden Coolify app, alternujeme git branches. Coolify provede checkout + redeploy.

**Pros**:
- Žádné 2× apps
- Clean git history (každý release = branch)

**Cons**:
- **Downtime během redeploy** (~30-90s pro KC, ~3 min pro core)
- Žádné fast rollback — vyžaduje další PATCH + redeploy
- Coolify cache může mít stale state (řešili jsme s `docker_compose_raw=null`)

**Vhodné pro**: dev/staging, kde downtime OK

### Varianta C — Multiple servers per app (NEDOPORUČENO bez load balancer)

```
aisha-keycloak na frontend1 (server-blue)
aisha-keycloak na frontend2 (server-green)
```

Coolify v4 podporuje multi-server projekty, ale routing mezi servery je manuální
(externí load balancer / Cloudflare Workers).

**Vhodné pro**: HA setup s externím LB, NE pro typické AISHA deployment.

---

## Doporučená implementace (Varianta A)

### Manifest extension

```diff
# coolify/manifests/aisha.manifest
- app: keycloak:backend:docker-compose.coolify-keycloak.yml
+ app: keycloak-blue:backend:docker-compose.coolify-keycloak.yml:bluegreen=keycloak
+ app: keycloak-green:backend:docker-compose.coolify-keycloak.yml:bluegreen=keycloak
```

Tag `bluegreen=<group>` označuje, že apps tvoří B/G dvojici.
- Story-init vytvoří 2 apps stejného compose, různá `BG_SLOT` env
- Deploy-init nastaví `BG_ACTIVE_HOST` jen na 1 (první = blue)

### Compose update (single source, parametrizováno)

```yaml
# docker-compose.coolify-keycloak.yml (existing, jen rozšíření labels)
services:
  keycloak:
    environment:
      KC_HOSTNAME: ${BG_ACTIVE_HOST:-localhost}
      BG_SLOT: ${BG_SLOT:-blue}
    labels:
      # Router se aktivuje JEN když BG_ACTIVE_HOST je nastaveno (non-empty).
      # Pokud prázdné, router nemá rule → Traefik ho ignoruje → no traffic.
      - "traefik.enable=${BG_ACTIVE_HOST:+true}"
      - "traefik.http.routers.keycloak-${BG_SLOT}.rule=Host(`${BG_ACTIVE_HOST:-_disabled.local}`)"
      - "traefik.http.routers.keycloak-${BG_SLOT}.entryPoints=https"
      - "traefik.http.routers.keycloak-${BG_SLOT}.tls.certresolver=letsencrypt"
```

### Switch skript (skeleton)

```bash
# bash scripts/blue-green-switch.sh keycloak
# Detekuje active slot, deploy alternate, smoke test, switch label.
```

(Stub implementace v `scripts/blue-green-deploy.sh` — viz commit.)

### Smoke test API

Per-stack smoke test config (single source: `config/blue-green-smoke.mjs`):
```js
export const smokeTests = {
  keycloak: {
    internalUrl: "http://aisha-keycloak-{slot}:8080/health/ready",
    externalUrl: "https://auth.aisha.guru/health/ready",
    expectedStatus: [200, 204],
  },
  n8n: {
    internalUrl: "http://aisha-n8n-{slot}:5678/healthz",
    expectedStatus: [200],
  },
  // ...
};
```

### Rollback workflow

```
1. switch fail → drift-watch alert
2. Operator: bash scripts/blue-green-switch.sh keycloak --rollback
3. Skript:
   a. PATCH active (failed): BG_ACTIVE_HOST=""
   b. Trigger redeploy active (Traefik drops route)
   c. PATCH idle (working): BG_ACTIVE_HOST=auth.aisha.guru
   d. Trigger redeploy idle (Traefik picks up route)
4. Verify healthy
```

Rollback je <30s (jen 2× PATCH + 2× redeploy trigger).

---

## Apps vhodné pro blue-green (priority)

| App | B/G priority | Důvod |
|---|---|---|
| keycloak | **HIGH** | Stateless (čte DB), critical auth path |
| n8n | **HIGH** | Workflow engine, downtime = ztracené triggery |
| edge (web) | **MEDIUM** | Static SPA, downtime = user-facing 502 |
| langfuse | LOW | Internal observability, krátký downtime OK |
| nocodb | LOW | Admin UI, krátký downtime OK |
| **core** | **NEPLATÍ** | DB + storage — stateful, blue-green nepoužitelné (nebo přes DB clustering, mimo scope) |
| pki | NEPLATÍ | Stateful CA, krátký downtime přijatelný |
| messaging (synapse) | NEPLATÍ | Stateful (sync state, federační koherence) |
| netbird | NEPLATÍ | Mesh state, peer registrations |

**Doporučení**: B/G nasadit **jen pro keycloak, n8n, edge** v první fázi. Core
a stateful apps mají krátký maintenance window (rolling restart) — výrazně
nižší risk než pokus o blue-green s shared state.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Schema migrations mezi blue/green | Backwards-compat schema rule (každá change musí být N-1 kompatibilní 1 release) |
| Cookie/session sticky uvíznou v old slot | Krátká cookie TTL (15 min), nebo session shared přes Redis |
| Double-write race během switch | Lock window — `BG_ACTIVE_HOST=""` na obou na 1-2s před nastavením nového active |
| Coolify deployment delay | Switch sequence dělá `wait_healthy` mezi kroky (ne fire-and-forget) |
| Stale Coolify state | Pre-flight: `node scripts/coolify-drift-check.mjs` před switch |

---

## Per-story B/G — granularitarita per AISHA story

**AISHA má first-class concept "story"** — každá story má vlastní workflow,
data namespace, a může mít vlastní stack instance. Per-story B/G znamená,
že **každá story může mít vlastní blue/green slot pro shared apps**.

### Použité scénáře

| Scénář | Per-story B/G | Vysvětlení |
|---|---|---|
| Velký multi-tenant zákazník | ✅ ano | Story = tenant, B/G per tenant |
| Test změny pro jednoho zákazníka před global rollout | ✅ ano | Switch B/G jen v jeho story, ostatní zůstávají na blue |
| Migrace mezi schemami | ✅ ano | Story X má green s novou schema, ostatní blue se starou |
| Bezpečnostní patch (urgent) | ❌ ne | Globální B/G na všechny stories najednou |

### Manifest schema rozšíření

Tag suffix `story=<scope>` ovládá granularitarita:

```
# coolify/manifests/aisha.manifest

# Globální B/G — affects all stories (default pokud chybí story=)
app: keycloak:backend:docker-compose.coolify-keycloak.yml:bluegreen=on

# Per-story B/G — separate blue/green pair PER story
app: orchestration:backend:docker-compose.coolify-n8n.yml:bluegreen=on:story=*

# Specific story-only B/G
app: edge:frontend:docker-compose.coolify-prebuilt.yml:bluegreen=on:story=customer-acme
```

Hodnoty `story=`:
- chybí → globální app (`bluegreen=on` affects all stories)
- `story=*` → per-story instances (separate B/G pair pro každou aktivní story)
- `story=<name>` → jen pro konkrétní story (pinned)

### Coolify mapping

Per-story instance má suffix v Coolify app name:

```
aisha-orchestration-blue           ← globální (story-agnostic)
aisha-orchestration-acme-blue      ← story "acme"
aisha-orchestration-acme-green
aisha-orchestration-globex-blue    ← story "globex"
aisha-orchestration-globex-green
```

Routing (Traefik labels):
```yaml
# docker-compose.coolify-n8n.yml — parametrized
labels:
  - 'traefik.http.routers.n8n-${BG_SLOT}-${STORY:-default}.rule=Host(`n8n-${STORY:-default}.aisha.guru`)'
```

Tj. story-aware DNS: `n8n-acme.aisha.guru`, `n8n-globex.aisha.guru`. Per-story
B/G switch: PATCH `BG_ACTIVE_HOST` jen v dané story instanci.

### n8n workflow update

`WF_BLUE_GREEN_ORCHESTRATOR` rozšíříme o `story` parameter:

```js
// parse-event node
const short = appName.replace(/^aisha-/, '').replace(/-(blue|green)$/, '');
// New: extract optional story segment
const storyMatch = short.match(/^(.+?)-(.+)$/);
const story = storyMatch ? storyMatch[2] : null;  // null = global
const baseApp = storyMatch ? storyMatch[1] : short;
```

`check-flag` čte manifest line a respektuje `story=` rule:
- `story=` chybí → flag platí pro all instances (story = null OR specific)
- `story=*` → flag platí jen pro specific story instances
- `story=<name>` → flag platí jen pokud event má matching story

### Per-story orchestration

Story manager (n8n workflow `WF_DEPLOY_STORY` už existuje) extend:
- Při create story → vytvořit per-story Coolify apps (jen pro `story=*` apps)
- Při delete story → smazat per-story apps
- Při B/G switch → switch jen v dané story (žádný impact na ostatní)

### Příklady deploy flow

**Globální upgrade keycloak**:
```
git push → Coolify deploys aisha-keycloak-green (single app, story-agnostic)
n8n → smoke → exec sandbox → switch
Result: VŠECHNY stories vidí novou KC verzi naráz
```

**Per-story n8n migration**:
```
git push WITH story-acme branch → Coolify deploys aisha-orchestration-acme-green
n8n → smoke (story=acme context) → exec sandbox → switch jen v acme
Result: Story "acme" má novou n8n verzi, ostatní stories pokračují na staré
```

**A/B test edge SPA pro acme**:
```
Manifest: edge ma bluegreen=on:story=customer-acme
git push (jen v branch s acme features) → Coolify deploys aisha-edge-acme-green
n8n → smoke → switch
Result: Acme traffic dostává experimentální verzi, ostatní stories nedotčené
```

### Implementační status (Phase 1.5 — incremental)

- [x] Manifest schema parser podporuje multiple tags (split na `,`)
- [ ] Story tag rule logika v n8n workflow (`check-flag` extension)
- [ ] Compose templates s `${STORY}` parametrizací (n8n + edge stacks)
- [ ] WF_DEPLOY_STORY integration s B/G pair creation
- [ ] Story-scoped Traefik routing test

## Self-driven validation přes n8n (klíčová architektura)

**Princip**: Blue-green switch **není** manuální shell skript spouštěný operátorem.
Je to **autonomní AISHA workflow řízený n8n**, který reaguje na Coolify deploy
events a sám rozhodne, zda promotovat new deployment do live trafficu.

### Flow

```
1. Developer push do gitu (release branch nebo manifest update)
2. Coolify webhook trigger → POST do n8n workflow
3. n8n workflow:
   a. Identifikuje, že deploynutá app má `bluegreen=on` flag
   b. Vyčte current active slot přes Coolify API (BG_ACTIVE_HOST env)
   c. Triggeruje deploy do INACTIVE slot (idle)
   d. Wait + smoke test inactive slot (interní endpoint)
   e. Decision:
      - Smoke OK → PATCH BG_ACTIVE_HOST switch (volá scripts/blue-green-deploy.sh
                   nebo přímo Coolify API přes HTTP node v n8n)
      - Smoke FAIL → leave inactive slot disabled, alert přes notification node
4. Post-switch: n8n verify externí endpoint (langfuse, slack notification)
```

### Proč n8n, ne shell skript

| Důvod | Detail |
|---|---|
| **Aisha už má n8n jako orchestration plane** | Workflow engine je deployed, integrovaný s Keycloak SSO, máme custom nodes (`packages/n8n-nodes-aisha`) |
| **Webhook-driven**: žádný cron polling | Coolify deploy event → instant n8n trigger |
| **Visual flow, accessible to non-engineers** | Operátor může upravit threshold timeoutu / smoke endpoint v n8n UI |
| **Persistence + audit log free** | n8n executions UI ukáže historii všech B/G switchů |
| **Notification fanout zdarma** | n8n má Slack/Mattermost/Email nodes — žádná vlastní webhook code |
| **Selektivita per-app** | Workflow filteruje apps s `bluegreen=on` flag, ostatní apps n8n ignoruje |

### Selektivita (důležité — ne každá app potřebuje B/G)

Manifest extension určuje, které apps procházejí n8n B/G workflow:

```
# coolify/manifests/aisha.manifest
app: keycloak:backend:docker-compose.coolify-keycloak.yml:bluegreen=on
app: orchestration:backend:docker-compose.coolify-n8n.yml:bluegreen=on
app: messaging:backend:docker-compose.coolify-matrix.yml          # ne B/G — stateful
app: core:backend:docker-compose.coolify.yml                      # ne B/G — DB layer
app: pki:backend:docker-compose.coolify-pki.yml                   # ne B/G — stateful CA
```

n8n workflow při webhook receive vyčte manifest, hledá flag → pokud není, spustí
**straight deploy** (current behavior, žádný switch). Pokud je → spustí B/G flow.

### Workflow blueprint (pseudo-JSON pro n8n)

```yaml
name: aisha-blue-green-orchestrator
trigger:
  type: webhook
  path: /webhook/coolify-deploy
  method: POST

nodes:
  - id: parse-event
    type: function
    code: |
      const { app_name, deployment_uuid } = $input.body;
      const short = app_name.replace(/^aisha-/, "").replace(/-(blue|green)$/, "");
      return { short, app_name, deployment_uuid };

  - id: read-manifest
    type: http-request
    url: https://repo.id3a.cz/aisha/evymo-ai-orchestrator/raw/main/coolify/manifests/aisha.manifest

  - id: check-bluegreen-flag
    type: function
    code: |
      const manifest = $node["read-manifest"].body;
      const line = manifest.split("\n").find(l => l.includes(`:${$node["parse-event"].short}:`));
      return { bluegreen: line?.includes("bluegreen=on") };

  - id: route
    type: switch
    on: $node["check-bluegreen-flag"].bluegreen
    branches:
      true:  → trigger-bg-flow
      false: → log-skip (informational only)

  - id: trigger-bg-flow
    type: http-request
    method: POST
    url: ${COOLIFY_URL}/api/v1/applications/${INACTIVE_UUID}/restart
    # ... zbytek B/G sekvence (viz scripts/blue-green-deploy.sh logiku)
    # Prováděno přímo v n8n přes HTTP nodes — žádné shell skripty nejsou potřeba

  - id: smoke-test
    type: http-request
    url: http://aisha-${short}-${INACTIVE_SLOT}:8080/health/ready
    expected: { status: 200 }

  - id: decision
    type: if
    condition: $node["smoke-test"].statusCode === 200
    true: → switch-traefik
    false: → alert-fail

  - id: switch-traefik
    type: http-request
    method: POST   # patch BG_ACTIVE_HOST
    # ...

  - id: alert-fail
    type: slack
    channel: "#aisha-deploy-alerts"
    message: "B/G switch FAIL pro {app_name} — inactive slot zůstal idle"
```

Workflow je deployovaný přes existující `scripts/aisha-workflows-deploy.mjs` —
součást standardního cold-start flow (step 6).

### Role shell skriptu vs n8n

`scripts/blue-green-deploy.sh` je **fallback / manual override** pro:
- Operator-iniciovaný switch v incident response
- Lokální testing (bez n8n běžícího)
- Hromadný switch po n8n maintenance

**V produkci je primary path n8n workflow**.

---

## Implementační checklist

- [x] Tento návrh dokument (BLUE_GREEN_DESIGN.md)
- [x] Stub skript [scripts/blue-green-deploy.sh](../../scripts/blue-green-deploy.sh) (manual fallback)
- [ ] Manifest schema parser podporuje `bluegreen=on` flag (selektivně per app)
- [ ] **n8n workflow `aisha-blue-green-orchestrator.json`** v `n8n/workflows/`
- [ ] Custom n8n nodes (pokud potřeba): coolify-app-status, traefik-label-patch
- [ ] Coolify webhook config: deploy event → n8n endpoint
- [ ] Story-init logika pro vytvoření blue+green pair (jen pro apps s bluegreen=on)
- [ ] Deploy-init logika pro `BG_ACTIVE_HOST` initialization (default: blue)
- [ ] Compose updates: parametrické Traefik router rules (KC, n8n, edge)
- [ ] `config/blue-green-smoke.mjs` per-app smoke endpoints (čteno n8n workflow)
- [ ] Gate test: smoke endpoint validity, manifest flag parser
- [ ] Runbook update s B/G workflow

Phasing:
- **Fáze 1**: pilot na keycloak — n8n workflow + Coolify webhook setup, manifest flag
- **Fáze 2**: rozšíření na orchestration (n8n self-deploy!), edge
- **Fáze 3**: B/G integrace s drift-watch (auto-rollback at fail) řízeno z n8n
- **Fáze 4**: AISHA decision rules — n8n nečte jen smoke endpoint, ale i langfuse
  metrics, sentry errors → smarter promote/rollback decisions

---

# Část 2: Implementation Detail (per-service state management)

# BLUE_GREEN_DESIGN.md — Per-Service Blue/Green pro AISHA stack

> **Status:** SPEC — Phase 2 z [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md)
> **Verze:** 1.0
> **Datum:** 2026-04-28

---

## TL;DR

Každá stateless Coolify app v AISHA stacku má **dva slot-y** (`blue` a `green`) — dvě paralelní Coolify aplikace se stejným compose souborem ale různými Traefik labely. Switch = atomická změna `active_slot` v `coolify_app_slots` tabulce + Traefik label rewrite via Coolify API. Stateful služby (Postgres, MinIO, Keycloak) B/G **nemají** — používají rolling restart.

---

## 1. Princip

### 1.1 Slot model

Pro každou B/G-eligible službu existují **dvě Coolify apps**:

```
aisha-gateway-blue   (Coolify app UUID: abc-blue)
aisha-gateway-green  (Coolify app UUID: abc-green)
```

Obě používají stejný `docker-compose.coolify-aisha-gateway.yml` (s `${SLOT}` substitucí v `container_name`, network aliases). Liší se:
- Coolify app UUID
- Image tag (`${IMAGE_TAG_BLUE}` vs `${IMAGE_TAG_GREEN}`)
- Traefik labely (`aisha-gateway-blue.${DOMAIN}` vs `aisha-gateway-green.${DOMAIN}` pro internal access; **veřejná doména pouze na active**)

### 1.2 Active slot promotion

V `coolify_app_slots` tabulce je `active_slot` field:

```sql
SELECT app_name, active_slot, blue_image_tag, green_image_tag
FROM coolify_app_slots
WHERE app_name = 'aisha-gateway';

--  app_name        | active_slot | blue_image_tag | green_image_tag
--  aisha-gateway   | blue        | sha-abc123     | sha-def456
```

V Coolify (přes API):
- `aisha-gateway-blue` má Traefik label `traefik.http.routers.aisha-gateway.rule=Host(\`aisha.guru\`)` → veřejně serves traffic
- `aisha-gateway-green` má Traefik label `traefik.http.routers.aisha-gateway-green.rule=Host(\`aisha-gateway-green.frontend.id3a.cz\`)` → jen interní pro smoke testy

Switch znamená:
1. Změnit Traefik label na `aisha-gateway-green` aby přebrala `aisha.guru`
2. Změnit Traefik label na `aisha-gateway-blue` aby používala internal-only host
3. `UPDATE coolify_app_slots SET active_slot = 'green', last_switch_at = now()`
4. Coolify reload (Traefik picks up label change)

---

## 2. Datový model

### 2.1 `coolify_app_slots` table

```sql
CREATE TABLE coolify_app_slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name        text NOT NULL UNIQUE,           -- canonical name, např. 'aisha-gateway'
  story_id        uuid REFERENCES stories(id),    -- vždy aisha-stack story pro AISHA služby
  blue_app_uuid   text NOT NULL,                  -- Coolify app UUID pro blue
  green_app_uuid  text NOT NULL,                  -- Coolify app UUID pro green
  active_slot     text NOT NULL CHECK (active_slot IN ('blue','green')),
  blue_image_tag  text,                           -- aktuální image tag v blue
  green_image_tag text,                           -- aktuální image tag v green
  blue_health     text DEFAULT 'unknown',         -- 'healthy'|'degraded'|'down'|'unknown'
  green_health    text DEFAULT 'unknown',
  last_switch_at  timestamptz,
  last_switch_by  uuid,                           -- user_id approvera (NULL = AISHA autonomous)
  switch_lock     boolean NOT NULL DEFAULT false, -- prevents concurrent switches
  switch_lock_at  timestamptz,                    -- pro stale lock detection
  switch_lock_by  text,                           -- node ID nebo workflow execution ID
  domain          text,                           -- veřejná doména (např. 'aisha.guru')
  internal_domain_blue  text,                     -- 'aisha-gateway-blue.frontend.id3a.cz'
  internal_domain_green text,                     -- 'aisha-gateway-green.frontend.id3a.cz'
  metadata        jsonb DEFAULT '{}'::jsonb,      -- additional config
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coolify_app_slots_active ON coolify_app_slots (active_slot);
CREATE INDEX idx_coolify_app_slots_lock ON coolify_app_slots (switch_lock) WHERE switch_lock = true;
CREATE INDEX idx_coolify_app_slots_story ON coolify_app_slots (story_id);
```

### 2.2 RPCs

```sql
-- Acquire switch lock (atomic, fails fast if locked)
CREATE FUNCTION acquire_slot_lock(
  p_app_name text,
  p_lock_owner text  -- workflow execution ID nebo similar
) RETURNS coolify_app_slots
SECURITY DEFINER SET search_path TO 'public'
LANGUAGE plpgsql AS $$
DECLARE
  v_row coolify_app_slots;
BEGIN
  UPDATE coolify_app_slots
  SET switch_lock = true,
      switch_lock_at = now(),
      switch_lock_by = p_lock_owner
  WHERE app_name = p_app_name
    AND (switch_lock = false OR switch_lock_at < now() - interval '10 minutes')
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Switch lock held by another process for app: %', p_app_name;
  END IF;

  RETURN v_row;
END;
$$;

-- Release switch lock + commit new active_slot
CREATE FUNCTION commit_slot_switch(
  p_app_name text,
  p_new_active_slot text,
  p_image_tag text,
  p_actor uuid DEFAULT NULL
) RETURNS coolify_app_slots ...

-- Release switch lock without committing (rollback)
CREATE FUNCTION abort_slot_switch(
  p_app_name text,
  p_reason text
) RETURNS coolify_app_slots ...

-- Read-only listing for dashboard
CREATE FUNCTION get_active_slots()
RETURNS TABLE (
  app_name text,
  active_slot text,
  active_image_tag text,
  inactive_slot text,
  inactive_image_tag text,
  last_switch_at timestamptz,
  active_health text,
  inactive_health text
) ...
```

Všechny tři mutating RPCs (`acquire_slot_lock`, `commit_slot_switch`, `abort_slot_switch`) volají `INSERT INTO audit_journal(action, metadata)` v rámci transakce. **Stale lock auto-release**: pokud `switch_lock_at < now() - interval '10 minutes'`, lock je považován za stale a nový process ho může převzít.

---

## 3. Switch protokol

### 3.1 Sekvence (success path)

```
Step  Akce                                                     Time budget
─────────────────────────────────────────────────────────────────────────
1     acquire_slot_lock RPC                                    < 100ms
2     Determine target_slot = oposite(active_slot)             < 1ms
3     Coolify API: PATCH env vars on target_slot app           < 2s
4     Coolify API: POST /deploy?uuid={target_uuid}&force=true  < 5s
5     Poll Coolify deployment status until 'finished'          ≤ 5min
6     blue-green-smoke-test edge fn                             < 60s
      ├─ HTTP probe target slot internal domain
      ├─ Sentry release health check
      └─ Optional: regression test suite
7     fn_evaluate_proposal_risk('blue_green_switch', ...)      < 100ms
      → low/medium → continue auto
      → high → WF_APPROVAL_GATE → wait for approval
8     Coolify API: PATCH Traefik labels swap                    < 2s
      ├─ Old active loses public domain, gets internal-only label
      └─ Old inactive gets public domain
9     Coolify API: POST /restart?uuid={old_active}              < 5s
                   POST /restart?uuid={new_active}                          (Traefik picks up labels)
10    commit_slot_switch RPC (sets active_slot, releases lock)  < 100ms
11    log_integration_action('blue_green_switch_complete', ...) < 100ms
```

**Total budget**: ~7 minut (worst case s deployment build).

### 3.2 Failure paths

| Krok | Selhání | Akce |
|---|---|---|
| 1 | Lock held | Abort, log, retry po 5 min |
| 4 | Coolify deploy fails | abort_slot_switch + log + Slack notify |
| 5 | Deploy timeout (>5min) | abort_slot_switch + Coolify cancel deploy |
| 6 | Smoke test fails | abort_slot_switch + log + WF_APPROVAL_GATE pro post-mortem decision |
| 7 | Approval denied | abort_slot_switch + log |
| 8 | Traefik label rewrite fails | **kritické** — log + Slack page admin + manual recovery |
| 10 | RPC fails | Retry 3x, pak Slack page (data inconsistency riziko) |

### 3.3 Idempotency

`commit_slot_switch` je idempotent:
- Pokud `active_slot` už je `p_new_active_slot`, vrátí current row bez UPDATE
- Pokud lock není drženo current process (mismatch `switch_lock_by`), raise exception

`abort_slot_switch` je idempotent:
- Pokud lock není drženo, no-op
- Vždy vrátí current state

---

## 4. Coolify Traefik label management

### 4.1 Label patterns

**Aktivní slot** (např. blue):
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.aisha-gateway.rule=Host(`aisha.guru`)"
  - "traefik.http.routers.aisha-gateway.entrypoints=websecure"
  - "traefik.http.routers.aisha-gateway.tls.certresolver=le"
  - "traefik.http.routers.aisha-gateway.service=aisha-gateway-svc"
  - "traefik.http.services.aisha-gateway-svc.loadbalancer.server.port=80"
  - "traefik.docker.network=coolify"
  - "coolify.managed=true"
  # Internal alias (pro smoke testy ze stejné sítě)
  - "traefik.http.routers.aisha-gateway-blue-internal.rule=Host(`aisha-gateway-blue.frontend.id3a.cz`)"
  - "traefik.http.routers.aisha-gateway-blue-internal.entrypoints=websecure"
  - "traefik.http.routers.aisha-gateway-blue-internal.tls.certresolver=le"
  - "traefik.http.routers.aisha-gateway-blue-internal.service=aisha-gateway-svc"
```

**Inaktivní slot** (např. green) — žádný public router, jen internal:
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.aisha-gateway-green-internal.rule=Host(`aisha-gateway-green.frontend.id3a.cz`)"
  - "traefik.http.routers.aisha-gateway-green-internal.entrypoints=websecure"
  - "traefik.http.routers.aisha-gateway-green-internal.tls.certresolver=le"
  - "traefik.http.routers.aisha-gateway-green-internal.service=aisha-gateway-green-svc"
  - "traefik.http.services.aisha-gateway-green-svc.loadbalancer.server.port=80"
  - "traefik.docker.network=coolify"
  - "coolify.managed=true"
```

### 4.2 Switch via Coolify API

Coolify ukládá labels v `applications` resource. PATCH endpoint:

```
PATCH /api/v1/applications/{uuid}
Body: {
  "docker_labels": "...newline-separated labels..."
}
```

Switch sequence:
1. PATCH `aisha-gateway-blue` UUID → labels bez `Host(\`aisha.guru\`)` router
2. PATCH `aisha-gateway-green` UUID → labels s `Host(\`aisha.guru\`)` router
3. POST `/api/v1/applications/{uuid}/restart` na obou (force Traefik label refresh)

**Critical**: Coolify má eventually consistent reload — Traefik picks up labels během 5-10s. Smoke test #2 (po Traefik switch) ověří, že nová URL serves new traffic.

### 4.3 Atomicita

Kroky 1-2 nejsou atomic napříč dvěma Coolify API calls. Po dobu race window (≤ 2s) může:
- **Dvě 200 OK response na `aisha.guru`** od obou slot-ů — OK (oba běží same-version pokud B/G fresh, nebo **nedeterministicky** mezi blue/green pokud `image_tag` se liší)
- **Žádné 200 OK** — pokud Coolify reload-uje obě simultánně. Velmi nepravděpodobné.

**Mitigation**: krok 1 nejprve **přidá** internal label (nemění Host(\`aisha.guru\`)) — žádný traffic disruption. Krok 2 **vymění** Host na green. Krok 3 (PATCH blue) **odstraní** Host z blue. Mezi 2 a 3 je oba slot-y mají Host(\`aisha.guru\`) — Traefik routes round-robin to oba, but oba běží same expected version (pokud image tag identický) nebo je to akceptovatelné kratké okno crossover.

---

## 5. Smoke test

> **V1 implementace**: smoke test je **inline v `WF_BLUE_GREEN_ORCHESTRATOR`** (n8n `httpRequest` node `Smoke Probe /api/v1/health` + `if` node `Smoke OK?`). Bez separátní edge function — jednodušší, méně movable parts. Edge function `blue-green-smoke-test` je budoucí enhancement (až bude potřeba bohatší probe matrix, paralelní HTTP, Sentry release health correlation).

### 5.1 Vstup (zamýšlený contract pro budoucí edge fn)

```typescript
{
  app_name: string;        // 'aisha-gateway'
  target_slot: string;     // 'blue' | 'green'
  target_url: string;      // 'https://aisha-gateway-green.frontend.id3a.cz'
  health_paths: string[];  // ['/api/v1/health', '/healthz']
  timeout_ms: number;      // default 30000
  sentry_release?: string; // 'aisha-gateway@sha-def456' pro Sentry release health
}
```

### 5.2 Validace

```typescript
import { z } from 'zod';

const SmokeTestRequest = z.object({
  app_name: z.string().min(1),
  target_slot: z.enum(['blue', 'green']),
  target_url: z.string().url(),
  health_paths: z.array(z.string().min(1)).default(['/api/v1/health']),
  timeout_ms: z.number().int().min(1000).max(120000).default(30000),
  sentry_release: z.string().optional(),
});
```

### 5.3 Kroky

1. **HTTP probes**: pro každý `health_path` zavolá `GET {target_url}{path}` s timeout. Akceptuje 2xx.
2. **Response time check**: p95 < 1s pro všechny probes.
3. **Sentry release health** (pokud `sentry_release` poskytnut): `GET ${SENTRY_URL}/api/0/projects/aisha/aisha-gateway/releases/{sentry_release}/` → ověř `crashFreeRate > 0.99`.
4. **Optional E2E**: Pokud `metadata.e2e_test_url` v slot row, zavolá ho jako extra probe.

### 5.4 Výstup

```typescript
{
  success: boolean;
  duration_ms: number;
  probes: Array<{
    path: string;
    status: number;
    duration_ms: number;
    success: boolean;
  }>;
  sentry_release_health?: {
    crash_free_rate: number;
    sessions: number;
    crashed_sessions: number;
  };
  failure_reason?: string;
}
```

---

## 6. AISHA-stack B/G eligibility matrix

| App | B/G | Důvod / Strategie |
|---|---|---|
| `aisha-gateway` | ✅ | Stateless HTTP API/SSR |
| `aisha-web` | ✅ | Static + edge SSR |
| `aisha-ws-gateway` | ✅ | Stateless WebSocket; clients reconnect |
| `aisha-exec` | ✅ | Stateless Deno isolated executor |
| `aisha-edge-runtime` | ✅ | Stateless Deno functions |
| `aisha-n8n` | ⚠️ Drain | Workflow exec stateful → před switch: stop new triggers, drain pending executions (max 5min), pak switch |
| `aisha-keycloak` | ❌ | Sessions cached in-memory; rolling restart only |
| `aisha-db` (Postgres) | ❌ | Single-instance + replica (replica není B/G) |
| `aisha-langfuse` | ❌ | Postgres + ClickHouse + Redis stateful trojce |
| `aisha-sentry` | ❌ | Vlastní DB + ClickHouse + Redis |
| `aisha-appsmith` | ❌ | Embedded MongoDB |
| `aisha-nocodb` | ❌ | Připojené k aisha-db (stateful migrace) |
| `aisha-elasticsearch` | ❌ | Single-node index |
| `aisha-minio` | ❌ | Object storage (single-instance) |
| `aisha-ragnarok` | ✅ | Stateless RAG API (ES je separátní) |

Stateful služby (❌) používají:
- **Rolling restart** (Coolify má interní healthcheck-aware restart)
- **Migrace database**: forward-compatible migrations (no breaking changes), hot-deployed přes `aisha-db-migrate` init container
- **Plánovaná údržba**: multi-minute downtime windows (oznámené)

---

## 7. Bootstrap pro AISHA stack

### 7.1 Iniciální setup (jednorázový)

Pro každou B/G-eligible službu:
1. Vytvořit duplicate Coolify app: `aisha-gateway-blue` a `aisha-gateway-green` (clone existující `aisha-gateway`)
2. Insert do `coolify_app_slots`:
   ```sql
   INSERT INTO coolify_app_slots (
     app_name, story_id, blue_app_uuid, green_app_uuid,
     active_slot, blue_image_tag, domain,
     internal_domain_blue, internal_domain_green
   ) VALUES (
     'aisha-gateway',
     (SELECT id FROM stories WHERE slug = 'aisha-stack'),
     'abc-blue', 'abc-green',
     'blue', 'sha-current',
     'aisha.guru',
     'aisha-gateway-blue.frontend.id3a.cz',
     'aisha-gateway-green.frontend.id3a.cz'
   );
   ```
3. Ověřit Traefik labely odpovídají active_slot (manuální PATCH na inactive slot pokud je out-of-sync)

### 7.2 Bootstrap script

`scripts/bootstrap-blue-green.mjs` — iteruje přes B/G-eligible apps z `aisha-stack.yml`, vytvoří chybějící Coolify duplicates přes API, populates `coolify_app_slots` rows. Idempotent (skip pokud row existuje). **Vyžaduje admin review** první run — výstup je preview only, manuální flag `--apply` pro real exekuci.

---

## 8. Risk evaluation pro `blue_green_switch`

```sql
-- Rozšíření fn_evaluate_proposal_risk pro novou kategorii
-- Volání: fn_evaluate_proposal_risk('blue_green_switch', metadata)
--
-- metadata: {
--   app_name: text,
--   target_slot: text,
--   image_tag_change: { from: text, to: text },
--   triggered_by: 'ci_push' | 'manual' | 'drift_remediation',
--   smoke_test_passed: boolean
-- }
--
-- Rules:
--   smoke_test_passed = false       → high (require approval)
--   triggered_by = 'manual'          → medium (auto + notify)
--   triggered_by = 'ci_push' &&
--     image_tag matches semver patch → low (auto, log_only)
--   image_tag matches semver minor   → medium (auto + notify dirigent)
--   image_tag matches semver major   → high (require approval)
--   triggered_by = 'drift_remediation' → medium (auto + notify)
--   default                          → medium
```

> **Pravidlo paliček**: prod-affecting switch ≤ medium, jinak `WF_APPROVAL_GATE`.

---

## 9. Audit a observability

### 9.1 Logged events

Každý switch generuje záznamy v:
- `audit_journal` — `action='blue_green_switch'`, `metadata={app_name, from_slot, to_slot, image_tag_old, image_tag_new, smoke_test, duration_ms}`
- `integration_actions` — service_name='n8n', action='blue_green_switch_complete'/'blue_green_switch_aborted'

### 9.2 Dashboard widgety (Phase 4)

Phase 4 dashboard zobrazuje:
- **Active slots table**: app_name, active_slot, active_image_tag, last_switch_at, active_health (TableWidget z `get_active_slots` RPC)
- **Recent switches timeline**: last 10 switches per app (TableWidget z `audit_journal`)
- **Switch frequency chart**: switches per app per 24h (StatBoxWidget + ChartWidget)

---

## 10. Otevřené otázky

1. **n8n drain strategy**: jak přesně signalizovat n8n "stop accepting new executions, drain pending"? Zatím navrženo via `N8N_DISABLE_PRODUCTION_MAIN_PROCESS=true` env var + restart, ale to ovlivní kompletní downtime. Alternativa: feature flag v n8n DB. — *future research*
2. **Cross-server B/G**: aktuálně B/G pouze na Frontend. Pro multi-server stories (gateway na Frontend + backend na Backend) je potřeba koordinovaný switch. — *future work, mimo Phase 2 scope*
3. **Blue-green test traffic %**: některé B/G implementace canary (10% traffic na green, monitor, ramp up). Aktuální design je big-bang switch. Canary lze přidat v Phase 2.5 přes Traefik weighted services. — *budoucí enhancement*

---

## 11. Reference

- [AUTONOMOUS_DEPLOY_FLOW.md](AUTONOMOUS_DEPLOY_FLOW.md) — master spec
- [DRIFT_OBSERVER.md](DRIFT_OBSERVER.md) — Phase 1 (drift může triggernout B/G remediation)
- [SENTRY_OBSERVER.md](SENTRY_OBSERVER.md) — Phase 3 (Sentry observer reverses B/G switch on failure)
- [APPSMITH_AISHA_OPS.md](APPSMITH_AISHA_OPS.md) — Phase 4 (vizualizace B/G state)
- [Coolify API docs](https://coolify.io/docs/api-reference)
- [Traefik dynamic configuration via Docker labels](https://doc.traefik.io/traefik/providers/docker/)
