# aisha-connect — napojení lokálních nástrojů na instanci AISHA

`scripts/aisha-connect/cli.mjs` připojí vývojářský stroj k **libovolné** instanci AISHA:
k lokálnímu stacku (výchozí), k vlastní (self-hosted) instanci nebo k oficiální hostované
instanci. Přihlášení proběhne přes Keycloak (device flow) a `validate` ověří celý řetěz
konec-konců. Nástroj funguje pro **tohle repo i pro jakékoli jiné repo**, ve kterém
s AISHA vyvíjíš.

Bez závislostí, jen Node ≥ 18. V tomhle repu: `npm run aisha:connect -- <příkaz>`.
Odjinud: `node <cesta k checkoutu>/scripts/aisha-connect/cli.mjs <příkaz>`. Praktický je alias:

```bash
alias aisha-connect="node $HOME/src/aisha-orchestrator/scripts/aisha-connect/cli.mjs"
```

## Rychlý start

```bash
# 1) Lokální stack (výchozí cíl — gateway z config/local-presets.mjs)
aisha-connect login
aisha-connect init            # v repu, kde pracuješ
aisha-connect validate

# 2) Oficiální instance (opt-in, nikdy výchozí)
aisha-connect login --url https://api.aisha.guru     # profil "aisha.guru"
cd ~/src/muj-projekt
aisha-connect init --profile aisha.guru
aisha-connect validate
```

`--url` je **API základ instance**: host, který servíruje `/.well-known/app-config.json`
(gateway). Všechno ostatní, tedy MCP, realm Keycloaku, web a anon klíč, si nástroj zjistí
od instance sám. Nic konkrétní instance není v kódu napevno.

## Co se kam zapisuje

| Kde | Co | Tajné? |
|---|---|---|
| `~/.config/aisha/profiles.json` (`$AISHA_CONFIG_DIR`, Windows `%APPDATA%\aisha`) | zjištěné instance: app-config, OIDC endpointy | ne |
| `~/.config/aisha/credentials.json` (práva **0600**) | access + refresh token pro každý profil | **ano**, nikdy v repu |
| `<repo>/.aisha/dirigent.local.json` | profil s URL instance + `activeProfile`; čte ho rozšíření Dirigent, Claude plugin i `scripts/dirigent` | ne (jen URL a veřejný anon klíč) |
| `<repo>/.gitignore` | doplní `.aisha/dirigent.local.json`, pokud ignorovaný není | ne |
| Claude Code, local scope (`~/.claude.json`, per projekt) | MCP server `aisha-knowledge` | ne (jen příkaz helperu) |

Jedno přihlášení slouží všem repům na stroji. Repo dostane URL, **nikdy token**.

## Jak se napojí jednotlivé nástroje

**Claude Code (MCP `aisha-knowledge`).** `init` ho zaregistruje v local scope jedním ze dvou
způsobů:

- `--mcp-auth helper` (výchozí): `headersHelper` volá `aisha-connect token --format header`.
  Token si obnoví sám, takže funguje i v dlouhé session, přes SSH, v kontejneru a v cloudovém
  sandboxu. Používá přihlášení z `login` (klient `aisha-dirigent-device`, který gateway i MCP
  server přijímají: `KC_ALLOWED_CLIENTS`). Claude Code helper spustí až v **důvěryhodném
  workspace** (jednou potvrď dialog důvěry v projektu).
- `--mcp-auth oauth`: nativní MCP OAuth Claude Code (`oauth.clientId: aisha-mcp-client`,
  `callbackPort: 59876`, shodně s evymo/aisha-orchestrator#3). Přihlášení proběhne v prohlížeči
  na stejném stroji. Tenhle tvar neobsahuje žádnou cestu ani tajemství, takže ho lze sdílet
  v `.mcp.json` celého týmu: `init --mcp project --mcp-auth oauth`.

`--mcp none` registraci přeskočí. Bez nainstalovaného `claude` CLI nástroj vypíše přesný
příkaz `claude mcp add-json …`.

**Rozšíření AISHA Dirigent (VS Code).** Čte `.aisha/dirigent.local.json`, tedy aktivní profil
a jeho `aishaUrl`, `mcpUrl` a `keycloakUrl`. Přihlásí se samo (vlastní device flow, tokeny
v SecretStorage editoru). `init` mu jen nastaví, kam se připojit.

**Skripty a CLI (`scripts/dirigent`, `aisha-mint-pat`, Claude plugin backend).**
`aisha-connect exec -- <příkaz>` spustí příkaz s URL instance a čerstvým tokenem v prostředí:
`AISHA_URL`, `AISHA_API_BASE_URL`, `AISHA_POSTGREST_URL`, `AISHA_MCP_URL`,
`AISHA_KEYCLOAK_URL`, `AISHA_ANON_KEY`, `AISHA_ACCESS_TOKEN` a `AISHA_TOKEN`. Existující
`AISHA_TOKEN` (dlouhodobý PAT `mcp_…`) se nepřepíše.

```bash
aisha-connect exec -- npm run evymo:health
aisha-connect exec --profile aisha.guru -- node scripts/aisha-mint-pat.mjs --story <uuid>
eval "$(aisha-connect env)"          # jen URL; --with-token přidá krátkodobý token
```

Access token Keycloaku žije krátce (realm: 5 min). Pro dlouhé běhy proto použij `exec`
(token se získá těsně před startem) nebo `token` v každém volání. Pro editor (Omni `/v1`) si
vyraz PAT přes `aisha-mint-pat`.

## Validace

`aisha-connect validate [--profile p] [--repo dir] [--check-mcp-oauth] [--json]` vrací exit 2,
když selže kterákoli kontrola. Když selže předpoklad, závislé kontroly se přeskočí, takže první
červený řádek je ten, který opravuješ.

| Kontrola | Co prokazuje |
|---|---|
| `app-config` | instance odpovídá a popisuje se stejně jako při `discover` (jinak varování „spusť discover") |
| `oidc-discovery` | realm z app-config odpovídá jako tentýž issuer (ochrana proti mix-up) a nabízí device grant |
| `protected-resource` | RFC 9728 metadata uvádějí realm, takže MCP klienti ho najdou sami (jen varování) |
| `gateway-health` | `GET <gateway>/health` → 200 |
| `mcp-requires-auth` | MCP **odmítne** anonymní `initialize` (401/403). Odpověď 2xx = FAIL, znalostní báze by byla veřejná |
| `login` | uložené přihlášení platí, případně se obnoví refresh tokenem |
| `token-claims` | `iss` = realm instance, `azp` = klient přihlášení, token neexpiroval. Vypíše i `aud` (viz soulad s PR #3) |
| `userinfo` | realm token přijme a `sub` sedí |
| `mcp-initialize` / `mcp-tools` | MCP s tvým tokenem: `initialize` 200 a `tools/list` vrací nástroje |
| `mcp-oauth-client` (volitelná) | realm zná `aisha-mcp-client` s callbackem `http://localhost:59876/callback` |
| `repo-config` | aktivní profil repa míří na tuhle instanci |

Výstup proti lokálnímu stacku s přihlášeným uživatelem (2026-10-08):

```text
  ✓ app-config          http://localhost:3001 (version 3)
  ✓ oidc-discovery      http://127.0.0.1:8180/realms/aisha
  ✓ protected-resource  authorization server http://127.0.0.1:8180/realms/aisha
  ✓ gateway-health      http://localhost:3001/health → 200
  ✓ mcp-requires-auth   anonymous initialize → 401
  ✓ login               connect-e2e@example.com (access token valid 289s)
  ✓ token-claims        iss ok, azp aisha-dirigent-device, aud -
  ✓ userinfo            connect-e2e@example.com
  ✓ mcp-initialize      aisha-mcp-knowledge-server 2.2.0 (protocol 2025-06-18)
  ✓ mcp-tools           16 tools
```

Proti `https://api.aisha.guru` prošlo všech pět kontrol před přihlášením i `mcp-oauth-client`.
Samotné přihlášení vyžaduje účet a potvrzení v prohlížeči.

## Soulad s evymo/aisha-orchestrator#3 (MCP OAuth)

PR #3 zavádí pro `/mcp` dvě věci:

- nativní MCP OAuth pro Claude Code: klient `aisha-mcp-client`, `WWW-Authenticate` s
  `resource_metadata`, metadata `/.well-known/oauth-protected-resource/functions/v1/mcp-knowledge-server`;
- požadavek na audience `aisha-mcp-knowledge` v tokenu (jinak 403).

Mapper audience přidává i klientovi `aisha-dirigent-device`. Podle PR je na živém Keycloaku
už nasazený. Tokeny z `aisha-connect login` proto na `/mcp` projdou i po sloučení PR #3. Před
ním to v lokálním realmu z téhle větve neplatí (`aud -`). Po něm `token-claims` ukáže
`aud aisha-mcp-knowledge`, a pokud tam chybí, `mcp-initialize` skončí 403.

Obě cesty fungují vedle sebe. Tým může sdílet `.mcp.json` s blokem `oauth` (PR #3, nebo
`init --mcp project --mcp-auth oauth`). Kdo pracuje bez prohlížeče na stejném stroji (SSH,
kontejner, cloud), si přes `init` zaregistruje helper v local scope. Local scope má
v Claude Code přednost před project scope.

## Bezpečnost

- Tokeny se posílají jen přes **https**. Plain http nástroj dovolí výhradně pro loopback
  (`localhost`, `127.0.0.0/8`, `::1`).
- Token, device a userinfo endpointy musí ležet na originu issueru. Issuer z app-config se
  musí shodovat s tím, co realm sám ohlásí.
- Požadavky nesoucí token nesledují přesměrování.
- `credentials.json` se zapisuje atomicky s právy 0600. `logout` revokuje refresh token na
  realmu a smaže ho lokálně.
- Do repa se zapisují jen URL a veřejný anon klíč. Malformovaný `.aisha/dirigent.local.json`
  nebo `.mcp.json` nástroj odmítne přepsat.

## Řešení potíží

- **`session ended` / exit 3**: SSO session realmu vypršela (v realmu z repa nečinnost
  30 min, maximum 10 h; nasazená instance může mít jiné hodnoty).
  Spusť `aisha-connect login` znovu. `login --offline` požádá o offline token. Realm
  `aisha` ho ale klientovi `aisha-dirigent-device` dnes **nedává**: klient nemá `offline_access`
  mezi volitelnými scopy a Keycloak scope tiše zahodí (ověřeno lokálně 2026-10-08). Nástroj
  na to upozorní. Povolit ho je rozhodnutí vlastníka realmu.
- **Claude Code: „headersHelper not run — no persisted trust"**: otevři projekt v Claude Code
  a potvrď dialog důvěry.
- **Claude Code hlásí chybu helperu po změně verze Node**: `headersHelper` nese absolutní cestu
  k `node` a k `cli.mjs`. Spusť `aisha-connect init` znovu.
- **`app-config: … got HTML`**: `--url` míří na web, ne na API. Použij `https://api.<doména>`.
- **Víc profilů**: profil vybírá `--profile`, potom `$AISHA_PROFILE`, potom aktivní profil repa
  (`.aisha/dirigent.local.json` → `connectProfile`) a nakonec výchozí profil (`status` ho
  označuje `*`).

Exit kódy: 0 v pořádku · 1 chyba · 2 neprošla validace · 3 je potřeba přihlášení.
