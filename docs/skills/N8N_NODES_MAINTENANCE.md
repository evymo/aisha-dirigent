# n8n Nodes Maintenance — Knowledge Base

> Kompletní návod pro údržbu, publikování a nasazení `n8n-nodes-aisha` balíčku.
> Tento dokument slouží jako reference pro AI agenty i lidské vývojáře.

---

## Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│                n8n-nodes-aisha Delivery Pipeline                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Source Code (packages/n8n-nodes-aisha/)                       │
│       │                                                         │
│       ▼  npm run build (TypeScript → dist/)                    │
│  Compiled dist/                                                 │
│       │                                                         │
│       ▼  npm version patch (bump version)                      │
│  package.json version bumped                                    │
│       │                                                         │
│       ▼  npm publish → Verdaccio (npm.id3a.cz)                │
│  Registry: n8n-nodes-aisha@x.y.z                              │
│       │                                                         │
│       ▼  Coolify API restart n8n container                     │
│  n8n entrypoint: detects new version → installs from Verdaccio │
│       │                                                         │
│       ▼  register-packages.mjs + self-setup.mjs                │
│  Nodes registered in n8n DB, workflows active                  │
└─────────────────────────────────────────────────────────────────┘
```

### Klíčové komponenty

| Komponenta | Cesta / URL | Popis |
|-----------|------------|-------|
| **Zdrojový kód** | `packages/n8n-nodes-aisha/` | TypeScript nody, credentials, workflows |
| **Build** | `packages/n8n-nodes-aisha/dist/` | Zkompilovaný JS |
| **Verdaccio** | `https://npm.id3a.cz/` | Privátní npm registr |
| **n8n instance** | `https://n8n.aisha.guru/` | Produkční n8n (Coolify) |
| **Coolify** | `https://frontend.id3a.cz/` | Deployment platforma |
| **n8n Coolify UUID** | `u00woowgoc8owwww8kcs84g0` | Pro API volání |
| **Deploy script** | `packages/n8n-nodes-aisha/scripts/deploy-to-n8n.mjs` | Build → publish → install |
| **Pipeline script** | `scripts/aisha-deploy-nodes.mjs` | Preflight → build → test → deploy → verify |
| **Ops script** | `scripts/n8n-ops.mjs` | Sync, verify, executions, creds |

---

## Prostředí a tokeny

Všechny tokeny v `.env.aisha` (NIKDY necommitovat):

| Proměnná | Popis | Použití |
|----------|-------|---------|
| `VERDACCIO_TOKEN` | JWT token pro npm publish | Publish do Verdaccio registru |
| `N8N_API_KEY` | n8n REST API klíč | Správa workflows, community packages |
| `N8N_WEBHOOK_URL` | n8n webhook URL | Webhook testy (Dirigent Agent apod.) |
| `COOLIFY_API_TOKEN` | Coolify API Bearer token | Restart/deploy n8n kontejneru |
| `GOOGLE_AI_API_KEY` | Google Gemini API klíč | LLM Router — primární provider |
| `OPENAI_API_KEY` | OpenAI API klíč | LLM Router — fallback provider |
| `ANTHROPIC_API_KEY` | Anthropic API klíč | LLM Router — fallback provider |

---

## NPM skripty

### Z kořene repozitáře (`npm run ...`)

| Příkaz | Popis |
|--------|-------|
| `npm run n8n:release` | **Kompletní release**: test → build → bump → publish → restart n8n |
| `npm run n8n:publish` | Build + bump + publish na Verdaccio (bez restartu) |
| `npm run n8n:restart` | Restart n8n kontejneru přes Coolify API |
| `npm run n8n:status` | Kontrola stavu n8n a nainstalované verze |
| `npm run aisha:nodes:deploy` | Legacy pipeline (preflight → build → test → deploy) |
| `npm run aisha:workflows:sync` | Stáhne workflows z n8n do `n8n/workflows/` |
| `npm run aisha:workflows:verify` | Health check: credentials, workflows, status |
| `npm run models:check` | Zobrazí katalog modelů a aktuální konfiguraci |

### Z balíčku (`cd packages/n8n-nodes-aisha && npm run ...`)

| Příkaz | Popis |
|--------|-------|
| `npm run build` | TypeScript kompilace + kopírování ikon |
| `npm test` | Vitest testy (173+ testů) |
| `npm run deploy:publish` | Build → publish → n8n API install |
| `npm run deploy:api` | Install z Verdaccio přes n8n API |

---

## Workflow: Release nové verze

### Rychlý release (doporučeno)

```bash
# Kompletní pipeline: test → build → bump → publish → restart
npm run n8n:release
```

### Manuální postup

```bash
# 1. Spusť testy
cd packages/n8n-nodes-aisha
npm test

# 2. Build
npm run build

# 3. Bump verze (patch/minor/major)
npm version patch --no-git-tag-version

# 4. Publish na Verdaccio
cd ../..
VERDACCIO_TOKEN="$(grep VERDACCIO_TOKEN .env.aisha | cut -d= -f2)" \
  npm publish ./packages/n8n-nodes-aisha --registry https://npm.id3a.cz/

# 5. Restart n8n (entrypoint auto-detekuje novou verzi)
npm run n8n:restart

# 6. Verifikace
npm run n8n:status
```

---

## Jak n8n detekuje novou verzi

n8n kontejner má custom entrypoint (docker-compose):

```bash
# Při startu/restartu:
INSTALLED_VER=$(node -p "require('./n8n-nodes-aisha/package.json').version")
LATEST_VER=$(npm view n8n-nodes-aisha version --registry "$VERDACCIO/")

if [ "$INSTALLED_VER" != "$LATEST_VER" ]; then
  # Stáhne tarball z Verdaccio a nainstaluje
  TARBALL_URL=$(npm view n8n-nodes-aisha dist.tarball --registry "$VERDACCIO/")
  wget -O /tmp/n8n-nodes-aisha.tgz "$TARBALL_URL"
  npm install /tmp/n8n-nodes-aisha.tgz
fi
```

**Proto stačí publishnout na Verdaccio + restartovat n8n.**
Žádný rebuild Docker image není nutný.

---

## Restart n8n přes Coolify API

```bash
# Restart kontejneru (použije existující image, spustí znovu entrypoint)
curl -sS -X POST "https://frontend.id3a.cz/api/v1/applications/u00woowgoc8owwww8kcs84g0/restart" \
  -H "Authorization: Bearer $COOLIFY_API_TOKEN"

# Alternativa: Force deploy (stáhne latest image)
curl -sS "https://frontend.id3a.cz/api/v1/deploy?uuid=u00woowgoc8owwww8kcs84g0&force=true" \
  -H "Authorization: Bearer $COOLIFY_API_TOKEN"
```

Po restartu (cca 60–120s na bootstrap):
- Healthz: `https://n8n.aisha.guru/healthz` → `{"status":"ok"}`
- Dirigent Agent: `POST https://n8n.aisha.guru/webhook/dirigent-agent`

---

## LLM Model Management

### Problém

LLM modely se deprecují (Google deprecoval `gemini-1.5-flash` i `gemini-2.0-flash`).
Změna modelu vyžaduje:
1. Update `DEFAULT_MODELS` v `AishaLlmRouter.node.ts`
2. Update `MODEL_CATALOG` v `scripts/models-check.mjs`
3. Build + publish + restart

### Kde jsou modely definovány

| Soubor | Konstanta | Popis |
|--------|-----------|-------|
| `packages/n8n-nodes-aisha/nodes/AishaLlmRouter/AishaLlmRouter.node.ts` | `DEFAULT_MODELS` | Runtime defaults pro auto-routing |
| `packages/n8n-nodes-aisha/nodes/AishaModelRouter/AishaModelRouter.node.ts` | Task-specific mapping | Per-task model selection |
| `scripts/models-check.mjs` | `MODEL_CATALOG` | Discovery a reporting |
| `scripts/models-wizard.mjs` | `PROVIDERS[].models` | Interaktivní konfigurace |

### Model Auto-Update (plánováno)

n8n workflow `WF_MODEL_BENCHMARK` provádí benchmark dostupných modelů.
Workflow `WF_MODEL_ROUTER` routuje podle task type a dostupnosti.

Automatická detekce deprecovaných modelů:
- Při selhání s errory typu `model is no longer available`, `RESOURCE_NOT_FOUND`
- LLM Router automaticky fallbackuje na další provider
- Pattern detection v `RESOURCE_NOT_FOUND_PATTERNS` konstantě

---

## Troubleshooting

### Publish selže s E401

```bash
# Příčina: chybí VERDACCIO_TOKEN
# Řešení: nastav env proměnnou
export VERDACCIO_TOKEN="$(grep VERDACCIO_TOKEN .env.aisha | cut -d= -f2)"
```

### Publish selže s E409

Verze už existuje na Verdaccio. Bump verzi: `npm version patch --no-git-tag-version`

### n8n po restartu nemá nové nody

1. Zkontroluj Verdaccio: `npm view n8n-nodes-aisha version --registry https://npm.id3a.cz/`
2. Zkontroluj n8n logy v Coolify — hledej `n8n-nodes-aisha: installed=X latest=Y`
3. Pokud `installed === latest`, verze byla správně nainstalovaná
4. Pokud nody chybí v UI, zkontroluj `register-packages.mjs` logy

### Model deprecated error

```
[GoogleGenerativeAI Error]: models/gemini-X is no longer available
```

1. Zkontroluj aktuální modely: `npm run models:check -- --validate`
2. Update `DEFAULT_MODELS` v `AishaLlmRouter.node.ts`
3. Update `AishaModelRouter.node.ts` references
4. Update testy
5. Release: `npm run n8n:release`

### n8n 504 Gateway Timeout na webhook

1. Zkontroluj health: `curl https://n8n.aisha.guru/healthz`
2. Zkontroluj executions: `npm run aisha:workflows:executions`
3. Pokud execution errors → zkontroluj n8n logy
4. Pokud health OK ale 504 → Coolify/Traefik timeout (výchozí 60s)

---

## Bezpečnost

- **NIKDY necommituj tokeny** — `.env.aisha` je v `.gitignore`
- **VERDACCIO_TOKEN** se používá jako env var, ne v `.npmrc` přímo
- **Publish pipeline** vždy spouští testy před publishem
- **postpublish hook** v `package.json` notifikuje n8n webhook (self-deploy)
- **Entrypoint** stahuje pouze z důvěryhodného Verdaccio (npm.id3a.cz)

---

## Soubory a adresáře

```
packages/n8n-nodes-aisha/
├── nodes/                    # TypeScript source nody
│   ├── AishaLlmRouter/      # LLM Router (multi-provider fallback)
│   ├── AishaModelRouter/    # Task-based model selection
│   ├── AishaRpc/            # Supabase RPC node
│   ├── AishaAudit/          # Audit logging
│   ├── AishaStoryManager/   # Story lifecycle
│   ├── AishaTrigger/        # Event triggers
│   ├── AishaNodeFactory/    # Dynamic node generation
│   └── AishaAdminBridge/    # Admin service bridge
├── credentials/              # n8n credential definitions
├── bootstrap/                # Auto-setup scripts (run inside container)
│   ├── register-packages.mjs # DB registration for community packages
│   └── self-setup.mjs       # Credential + workflow provisioning
├── workflows/                # n8n workflow JSON files for auto-import
├── scripts/
│   ├── deploy-to-n8n.mjs   # Build + publish + install
│   └── copy-icons.mjs      # Post-build icon copy
├── __tests__/               # Vitest tests (173+)
├── dist/                    # Compiled JS output
└── package.json             # v0.5.7+ (n8n-nodes-aisha)
```
