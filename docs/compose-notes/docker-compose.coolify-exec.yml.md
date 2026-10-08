# docker-compose.coolify-exec.yml — notes

Prose extracted from `docker-compose.coolify-exec.yml` by `scripts/compose-extract-notes.mjs`.
The compose file is passed to Coolify as a command-line argument and competes
with ARG_MAX, so it carries configuration only.

Each heading is the configuration line the note was attached to.

## `x-svc-common: &svc-common`

==============================================================================
Coolify story: aisha-exec (Experimental — isolated execution plane)
==============================================================================
Standalone svc-agent-runner deployed to Experimental. Talks to svc-plugin-system on
Backend via Netbird mesh DNS (backend.mesh.aisha.internal). Uses local containerd
Docker socket with Kata Containers runtimes (kata-fc, kata-dragonball)
installed via infra/ansible/experimental-kata.yml.

IMPORTANT: This stack assumes Experimental has been provisioned with:
  - Docker daemon backed by containerd
  - kata-runtime + kata-fc + kata-dragonball runtimes registered in
    /etc/docker/daemon.json runtimes section
  - the runs network `<prefix>-exec-runs` (DOCKER_EXEC_NETWORK) is created by the
    runner at run time as `Internal: true`; an existing open network of that name
    is REFUSED (see `## DOCKER_EXEC_NETWORK` below).
==============================================================================

## `container_name: aisha-svc-agent-runner`

Registry-free workspace build (@aisha/* from source) — no VERDACCIO_TOKEN.

## `KEYCLOAK_REALM: ${KEYCLOAK_REALM}`

── Identity (Keycloak on Backend, reached via mesh) ─────────────────────

## `PLUGIN_SYSTEM_URL: ${PLUGIN_SYSTEM_URL}`

── Plugin system (Backend, reached via mesh) ────────────────────────────

## `RUNNER_BACKEND: ${RUNNER_BACKEND:-kata}`

── Containerd / Kata runtime ─────────────────────────────────────────

## `KATA_GRPC_ENDPOINT: ${KATA_DEFAULT_RUNTIME}`

Default runtime when profile is not specified or when profile is unknown.
Per-run profile mapping happens in kata.ts: kata-firecracker→kata-fc,
kata-dragonball→kata-dragonball.

## `MAX_CONCURRENT_CLAUDE_RUNS: ${MAX_CONCURRENT_CLAUDE_RUNS:-3}`

Host RAM budget for claude_cli_task = EXEC_MEMORY_LIMIT × MAX_CONCURRENT_CLAUDE_RUNS.
Size MAX_CONCURRENT_CLAUDE_RUNS so the product stays under host RAM minus
daemon+OS headroom. Isolation bounds blast radius per run; this bounds the COUNT.

## `DOCKER_EXEC_NETWORK: …-exec-runs` — síť běhů UZAVŘENÁ (2026-10-06, majitel „síť zavřít“ = volba A)

Síť běhů zakládá runner (`backends/docker-http.ts` `ensureExecNetwork`) s `Internal: true`
a `com.docker.network.bridge.inhibit_ipv4=true`: žádná výchozí trasa, žádný NAT ven a hostitel
v ní nemá adresu. ⛔ NAMĚŘENO 2026-10-07 místní sondou (Docker 29.7.2): z `Internal` sítě BEZ
`inhibit_ipv4` se běh spojil s posluchačem hostitele na adrese brány bridge (172.x.0.1:port) —
tedy s čímkoli, co na hostiteli poslouchá na 0.0.0.0; s volbou bridge adresu nemá. Runner
proto odmítne i uzavřenou síť, která má v IPAM bránu nebo volbu nenese (starší Docker ji nezná). Kontejner běhu (plugin i claude_cli_task) dosáhne jen
na sousedy v téže síti — a jediný soused, který v ní něco obsluhuje, je runner s broker-proxy
(`BROKER_PROXY_ALIAS` : `BROKER_PROXY_PORT`, viz níž „broker-proxy na exec síti“):

- `POST /sandbox/*` + `GET /beh/payload` → broker / runner, jen s tokenem běžícího běhu,
- `CONNECT host:port` (výstup claude_cli_task) jen s tokenem běhu v `Proxy-Authorization`,
  jen na hostitele, které runner TOMU běhu povolil z jeho konfigurace (ANTHROPIC_BASE_URL /
  AGENT_LOCAL_LLM_URL, AGENT_GATEWAY_URL, AGENT_GIT_REMOTE, NPM_REGISTRY_URL — jen `https:`),
  a jen na veřejnou adresu (ochrana SSRF z `@aisha/security`: ne RFC1918, ne mesh 100.64/10,
  ne metadata). Běh pluginu výčet nemá → CONNECT nikam.

Runner síť MĚŘÍ před KAŽDÝM během (žádná paměť „ověřeno“): síť toho jména, která uzavřená
NENÍ, má adresu hostitele, chybí po založení, nebo odpověď Dockeru nejde přečíst → běh se nespustí (chyba se jménem
sítě, `containers/create` se nezavolá). Otevřenou síť nikdy tiše nepoužije.

**Proč nové jméno `-exec-runs` (dřív `-exec-net`):** starou síť `-exec-net` zakládal runner
jako otevřený `bridge` a na existujících hostitelích dál leží — pod starým jménem by ji runner
správně odmítl a běhy by stály na ručním `docker network rm`. Nové jméno = runner založí čistou
uzavřenou síť sám a nasazení zůstává automatické; stará síť zůstane bez kontejnerů a smí se
odstranit kdykoli.

Zbytkové riziko (vědomé): běhy v téže síti se vidí navzájem na L3 (`enable_icc=false` by
odřízlo i proxy runneru). Obrazy běhů nic neposlouchají; oddělení běhu od běhu = samostatná
síť na běh.

## `EXEC_PIDS_LIMIT` · `CLAUDE_PIDS_LIMIT` · `EXEC_RUN_USER` · `CLAUDE_RUN_USER`

Prázdno (`${X:-}`) = výchozí hodnota v `services/svc-agent-runner/src/config.ts` (jediný domov
výchozích hodnot): strop procesů 128 (plugin) / 1024 (claude), uživatel 1000 (`USER node`
obrazu plugin-exec) / 10001 (`agent` v Dockerfile.agent-claude). Uživatel je ČÍSELNÝ uid[:gid]
≠ 0 — jméno by si obraz mohl namapovat na root. Nečitelná hodnota = runner NENASTARTUJE
(neznámý bezpečnostní přepínač = fail-closed); totéž platí pro `BROKER_PROXY_PORT`.

## `ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL:-}` — model claude_cli_task (2026-10-07, revize D6)

Síť běhů je uzavřená, takže claude běh potřebuje adresu modelu, kterou broker-proxy pustí:
veřejnou `https`. Env-doktor ji ODVOZUJE (`modelBehuAgenta()`): veřejná tvář „AISHA jako
model“ `https://<GATEWAY_DOMAIN_PUBLIC>` (= `ask.<public_tld>` z derive-domains, core gateway
/v1). Operátor ji smí přepsat v `.env-prod-backup` (jiný model / vlastní endpoint). Instance bez
veřejné tváře modelu dostane prázdno a claude běhy hlasitě odmítne (fail-closed) — doktor ji
vypíše mezi „Odvozené a PRÁZDNÉ“. „Jen redeploy exec“ tak hodnotu doručí: doktor v APPLY ji
zapíše do `.env.coolify`, `coolify-sync-envs` ji pošle aplikaci exec (compose ji čte).

Výčet výstupu a ochrana SSRF proxy jsou jedno rozhodnutí: příprava claude běhu změří KAŽDOU
deklarovanou adresu (model, AGENT_GATEWAY_URL, AGENT_GIT_REMOTE, NPM_REGISTRY_URL) toutéž
ochranou SSRF, jakou ji pak pustí CONNECT. Adresa do meshe nebo soukromé sítě (např.
AGENT_LOCAL_LLM_URL na interní LLM, AGENT_GATEWAY_URL na interní bránu) shodí přípravu s názvem
proměnné — ne až první volání modelu uprostřed běhu. Interní endpoint se do claude běhu dostane
jen přes jeho veřejnou tvář (edge), ne bokem.

Autentizace k modelu je mimo tuto změnu: na veřejné tváři ji ověřuje Omni (PAT,
`validate_mcp_token`) — `ANTHROPIC_API_KEY` / `AGENT_CLAUDE_OAUTH_TOKEN` dodává operátor.

## API runneru (port 3030) — jen změřené adresy runneru mimo síť běhů

Hák API (`server.ts`, `pristupKApi` v `broker-proxy.ts`) obsluhuje JEN smyčku (healthcheck) a
adresy runneru v sítích MIMO síť běhů, změřené přes Docker při každém `zajistiCestuKBrokeru`.
Dokud změřené nejsou (start, výpadek Dockeru, neprošlé měření sítě), API mimo smyčku odpovídá
503 `runner_site_nezmereny` a runner měření opakuje každých 30 s. Adresa, která přibude
později (náhrada sítě běhů), ve výčtu není → 404. Dřív hák odmítal jen ZNÁMOU adresu v síti
běhů a do jejího zjištění pouštěl vše (osiřelý běh z minulé generace runneru na API dosáhl).

## `NPM_REGISTRY_URL: ${NPM_REGISTRY_URL:-}`

Registr balíčků pro claude_cli_task: runner ho předá běhu jako `npm_config_registry` a jeho
hostitel přidá do výčtu brány. Hodnotu instance deklaruje env-doktor (`NPM_REGISTRY_URL`).

## Bez `NETBIRD_*` (2026-10-06)

Runner dřív pro KAŽDÝ běh razil klíč k mesh síti (NetBird setup key) a předával ho do prostředí
kontejneru (`NB_SETUP_KEY`), kde ho žádný obraz nepoužil — jen ležel na dosah pluginu, který
vystoupí z VM. Volba A: klíč se nerazí vůbec, a runner proto nedostává ani pověření ke správě
mesh sítě (`NETBIRD_MGMT_SECRET` jako `NETBIRD_KEYCLOAK_CLIENT_SECRET`, `NETBIRD_API_*`,
`NETBIRD_SANDBOX_GROUP`). Mesh trasa samotného runneru (`NETBIRD_PEER_CIDR` přes
`NETBIRD_DNS_IP`) zůstává — tou vede broker-proxy k brokeru.

## `AISHA_DB_URL: ${AISHA_DB_URL}`

── DB / RPC (svc-agent-runner needs to update agent_runs) ────────────

## `AGENT_RUNNER_WAKE_TOKEN: ${AGENT_RUNNER_WAKE_TOKEN:-}`

Shared token for POST /wake — event-worker forwards 'agent_run_queued' NOTIFYs
to http://aisha-svc-agent-runner:3030/wake?token=... (config.ts:103 wakeToken).
Empty-safe: unset ⇒ the /wake route is unauthenticated-closed, executor stays
dormant. Plumbed so the event-primary activation is a Coolify-env change, not
a compose edit (pairs with WEBHOOK_AGENT_RUNNER on the event-worker).

## `CLAUDE_POLL_ENABLED: ${CLAUDE_POLL_ENABLED:-false}`

── Claude CLI agent runs (kind=claude_cli_task, Component 4 E4) ───────
All values operator-provided via env — no hardcoded paths/images/URLs/tokens.
FAIL-SAFE: the auto-draining poller is OFF unless explicitly enabled — set
CLAUDE_POLL_ENABLED=true only once the host is sized for the RAM budget above.

## `AGENT_CLAUDE_OAUTH_TOKEN: ${AGENT_CLAUDE_OAUTH_TOKEN:-}`

Subscription (CLI's primary auth — no API key): `claude setup-token`.

## `AGENT_CLAUDE_HOME_DIR: ${AGENT_CLAUDE_HOME_DIR:-}`

Host path to the agent's ~/.claude dir (a PATH, not a secret value) —
bind-mounted read-only into each run; the directory carries the credential.

## `AGENT_LOCAL_LLM_URL: ${AGENT_LOCAL_LLM_URL:-}`

Local LLM fallback (Anthropic-compatible) when no subscription/key.

## `- /var/run/docker.sock:/var/run/docker.sock:rw`

Containerd-backed Docker socket on Experimental.

## `S=/var/run/docker.sock` (entrypoint svc-agent-runner, 2026-09-29)

⛔ Namontovaný socket NESTAČÍ. Proces runneru běží přes `su-exec node` (uid/gid
1000) a su-exec mu dá jen skupiny z `/etc/group` — skupina vlastníka socketu mezi
nimi nebyla. Naměřeno na instanci po nasazení opravy void RPC (kolo 12): každý běh
pluginu v :55 skončil `connect EACCES /var/run/docker.sock` (socket `root:989 660`,
proces `uid=1000 groups=1000`), surová data konektorů zůstala 0.

Proto entrypoint (ještě jako root, po trase do meshe) přečte GID VLASTNÍKA socketu
(`stat -c %g`), založí pro něj skupinu, pokud v obrazu není, a přidá do ní `node`.
GID se NEPÍŠE natvrdo (`group_add: [989]`): liší se po hostitelích a číslo z jednoho
serveru by na jiném tiše dalo přístup cizí skupině. Patří-li socket skupině 0
(root), `node` se do ní NEPŘIDÁ — to by byl root celého obrazu; entrypoint to
ohlásí a běhy dál padnou nahlas. Chybí-li socket, entrypoint to ohlásí (backend
`docker` pak nemá kam volat; `kata` jde přes gRPC).

Cesta je DOSLOVNĚ bod připojení z `volumes:` téhož souboru (`- /var/run/docker.sock:/var/run/docker.sock:rw`),
ne proměnná: `$${DOCKER_SOCKET:-…}` by hádal (brána zadny-fallback-nad-identitou) a `$${DOCKER_SOCKET:?}`
brány čtou jako compose klíč, který musí zapsat cold-start (deklarace-v-compose-ma-zapisovatele,
build-time-mnozina-vsech-compose) — přitom jde o proměnnou kontejneru. Změní-li se mount, mění se oba řádky spolu.

## `- ./config/pki:/certs/pki:ro`

PKI bundle synced from Backend out-of-band (rsync) or fetched at boot.

## `- "${AGENT_RUNS_DIR}:/var/lib/agent-runs:rw"`

Adresář běhů claude_cli_task (od 2026-09-24). Runner si pro KAŽDÝ běh naklonuje
repo z `AGENT_GIT_REMOTE` do `/var/lib/agent-runs/<runId>` (pevný cíl — Coolify
`${` v cíli svazku odmítá) a dítěti přes docker socket dá TENTÝŽ adresář pod
hostitelskou cestou instance `${AGENT_RUNS_DIR}` (`Binds: <hostitel>/<runId>:/work`).
Runner tedy rozlišuje cestu v kontejneru (fs, git) a na hostiteli (Binds) —
`config.agentRunsContainerDir` / `agentRunsHostDir`; brána claude-cli-backend
čte cíl z configu, aby compose a kód neměly dva domovy.

`AGENT_RUNS_DIR` odvozuje generate-secrets z identity (`/var/lib/<identita>/agent-runs`),
takže exec dvou instancí na jednom stroji nesdílí adresář. Ve zdroji stojí `${VAR}`
s celou cestou bez výchozí hodnoty (`${VAR:-x}` Coolify rozvine vždy na x).

### Historie: doslovné `/var/lib/aisha/agent-runs` a `:ro` `/srv/aisha/base-repo` (do 2026-09-24)

Doslovné cesty (premisa „Coolify `${` ve zdroji odmítá" platila jen pro Coolify
beta.441–442) sdílel exec tří instancí na jednom stroji (naměřeno 2026-09-23).
Sdílený base-repo nikdo neplnil (prázdný od 2026-06-30) a byl `:ro`, takže
`git worktree add` do něj zapsat nemohl — claude_cli_task nefungoval nikde.
Dítě navíc vidělo jen `/work`, jehož `.git` ukazoval do repa runneru, takže
commit/push v dítěti selhával. Klon per běh řeší obojí: `/work` má vlastní `.git`
a přihlášení jde gitu jen přes env (`GIT_CONFIG_*` → `http.extraHeader`).

## `internal:`

Both `internal` and `coolify` alias the external coolify network — avoid
per-stack bridges (Docker default address pool exhaustion).

## `KEYCLOAK_URL: ${KEYCLOAK_URL}`

svc-agent-runner si z tohohle hostu skládá jwks_uri. Jde MESHEM, jako
ostatní logika: služba není v bootstrap cestě, takže v okamžiku, kdy
ověřuje tokeny, mesh už běží. Kolokace s Keycloakem se tím nevyžaduje
a služba může sedět na jiném nodu.

## `external: true`

EXTERNAL: síť zakládá warmup aplikace (docker-compose.coolify-netinit.yml)
na každém hostu PŘED vlnami a cold-start ji po rolloutu smaže. Kdyby ji
compose VLASTNIL, pokusil by se ji při teardownu smazat — a když na ní visí
kontejner jiného projektu, spadne celé nasazení (naměřeno 2026-08-11 na
aisha-clamav: "network ... has active endpoints").

## `external: true`

EXTERNAL — zakládá ji táž warmup aplikace, se subnetem z MESH_DNS_SUBNET
(mesh-router si na téhle síti pinuje ipv4_address, takže rozsah musí být
náš, ne náhodný z Dockeru).


## Proza presunuta z compose (2026-09-04)

Soubor se posila na server JAKO ARGUMENT PRIKAZU a soutezi s `ARG_MAX` — jeho
vlastni hlavicka rika, ze ma nest KONFIGURACI ONLY. Brana
`compose-nese-konfiguraci-ne-prozu` to vymaha rohatkou.

### `plugin-exec-image`

```
Sandbox pluginů: obraz `aisha/plugin-exec:v1` MUSÍ na hostiteli existovat —
runner ho spouští jménem přes docker.sock a NIKDO jiný ho nestavěl
(naměřeno 2026-08-17: images/plugin-exec/ v repu, žádná CI úloha, žádný
compose, AGENT_RUNNER_IMAGE prázdný ⇒ default ukazoval na neexistující tag
a execute route by 500kovala až za běhu). Staví se TADY, v témže stacku,
kde ho runner spotřebovává — žádný osmý deploy kanál.

Kontejner po buildu jen spí: běžící kontejner obraz zároveň JISTÍ proti
`docker image prune` (táž mina, na kterou dřív padlo jádro s lokálním
tagem). Není to služba s API — expose nic, síť interní.
```

### `plugin-exec-tag` — a proč `plugin-exec-image` NEMÁ `image:`

Záměr výše platí; padl jeho nevyslovený předpoklad, že se **staví a běží na
témže uzlu**. Coolify staví na build serveru a na cíl přenáší **jen obrazy,
které pojmenoval sám** (`<uuid>_<sluzba>:<sha>`). Služba s pevným `image:` se
postaví na builderu a nedorazí; cíl ji pak zkusí stáhnout (na Hubu není) a pak
postavit — jenže tam repo není.

Naměřeno 2026-09-05 při nasazení `<fork>-exec`; rozpor je v logu vidět jako dvě
čísla vedle sebe — `Built` třikrát, `Transferring 2 built image(s)`. Na cíli
pak `lstat …/images: no such file or directory` a **celý stack zůstal dole**.

Proto: `plugin-exec-image` `image:` nemá (Coolify ji pojmenuje a přenese) a
stabilní jméno `aisha/plugin-exec:v1`, které runner a `AGENT_IMAGE_ALLOWLIST`
potřebují, vzniká **přeznačením na cíli**. Zdroj se hledá přes JMÉNO KONTEJNERU
(`docker inspect -f '{{.Image}}'`), ne přes Coolify konvenci pojmenování —
runtime nemá viset na tvaru cizího nástroje.

Drží to brána `stavena-sluzba-nesmi-mit-pevny-tag` (ověřena mutací).

#### Zdroj se hledá podle LABELŮ, ne podle `container_name`

Coolify `container_name` **přepisuje** na `<sluzba>-<uuid>-<náhoda>`. Táž mina
jako u mesh aliasu o pár služeb výš — jen o vrstvu níž: alias řeší **síť**,
tohle je **docker API**. První pokus hledal `<prefix>-plugin-exec-image` a
skončil `Error: No such object`.

Nosné jsou labely, které Coolify nechává být:

```
com.docker.compose.service = plugin-exec-image
coolify.resourceName       = <fork>-exec
```

#### Proč `plugin-exec-image` nese `build.labels` `coolify.managed: "true"`

Přeznačené jméno žilo jen do nejbližšího úklidu Dockeru od Coolify. Naměřeno
2026-09-30 v tabulce `docker_cleanup_executions`: úklid na cílovém uzlu vypsal
`Untagged: aisha/plugin-exec:v1` devětkrát od 2026-09-06, tedy po každém
nasazení `<fork>-exec` v nejbližším úklidu (denním i vynuceném nad prahem
disku). Runner pak žádá o obraz, který na hostiteli není.

Krok úklidu je upstream Coolify: bere každý obraz s tagem, jehož jméno
nezačíná uuid prostředku, a ušetří ho jen tehdy, když konfigurace obrazu nese
štítek `coolify.managed=true`. Spící kontejner výše jistí **obraz** (ID) proti
`docker image prune`, ne **jméno** — `docker rmi aisha/plugin-exec:v1` obraz
s dalším tagem jen odznačí.

Štítek z `build.labels` je v konfiguraci obrazu, takže ho `docker tag` přenese
i na stabilní jméno. Coolify z `build:` čte jen `args` a přidává tag, `labels`
nechává být. Drží to brána `stavena-sluzba-nesmi-mit-pevny-tag` (druhý
`describe`: obraz, který jiná služba přeznačuje, nese štítek).

#### Proč má `svc-agent-runner` TVRDOU podmínku na dokončení

Bez přeznačeného obrazu runner nemá co spustit — `aisha/plugin-exec:v1` je
jméno, kterým o sandbox žádá `svc-plugin-system` i `AGENT_IMAGE_ALLOWLIST`.

`depends_on: { plugin-exec-tag: { condition: service_completed_successfully } }`
je tam **záměrně**: jednorázová služba, která selže, jinak projde jako zelená
(`restart` bez restartu + vypnutý healthcheck) a vada se ukáže až za běhu jako
500 na `execute`. Naměřeno 2026-09-05: nasazení hlásilo `healthy`, přeznačovač
přitom skončil s `exit 1` a obraz na hostiteli nebyl. Radši ať stack nenaběhne,
než aby předstíral, že je v pořádku.

## svc-agent-runner: broker-proxy na exec síti (rozhodnutí majitele 2026-10-01, varianta C)

- **Naměřeno 2026-09-30 na instanci:** běhy pluginů (konektory) končily hodinu co
  hodinu `Exit code 255`. Z exec sítě se `PLUGIN_BROKER_URL` (jméno v meshi) nepřeloží —
  sandbox v meshi není, obraz plugin-exec nemá klienta NetBird a per-run klíč NetBird
  padal na „fetch failed“ (KEYCLOAK_URL v meshi runner nepřeložil).
- **Řešení:** runner, který v meshi je (DNS mesh-routeru + trasa `NETBIRD_PEER_CIDR`),
  se za běhu SÁM připojí k exec síti pod aliasem `BROKER_PROXY_ALIAS`
  (`<prefix>-plugin-broker`, GwPriority −1 → exec síť nikdy není výchozí trasou) a na
  `BROKER_PROXY_PORT` pustí jen `/sandbox/*` s tokenem běhu, který právě běží. Ven jde jen
  `authorization` a `content-type`. Běh dostane `BROKER_URL` na proxy; per-run NetBird se
  od 2026-10-06 nevydává vůbec (volba A).
- API runneru (docker.sock) na exec síti odmítá vše (404) — sandbox smí jen na proxy.
- Síť se nedeklaruje v compose: zakládá ji runner až za běhu (`ensureExecNetwork`), na
  čisté instanci by při nasazení ještě neexistovala. Od 2026-10-06 (volba A) s `Internal: true`
  a proxy je POVINNÁ (`BROKER_PROXY_ALIAS` chybí = runner nenastartuje) — viz
  `## DOCKER_EXEC_NETWORK` výš.
- `AISHA_DB_URL` odebrán: kód runneru ho nepoužívá (do DB jde přes PostgREST), proměnná jen
  zbytečně držela přímý přístup do databáze.
- Neúspěšný běh nese v `error_summary` konec výstupu kontejneru (posledních 5 řádků, tokeny
  maskované, strop 600 znaků) — dřív jen „Exit code N“.
