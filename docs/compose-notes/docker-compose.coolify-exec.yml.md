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
  - aisha-exec-net Docker network (created by the runner on first boot
    or pre-created via the Ansible playbook).
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

## `NETBIRD_ENABLED: ${NETBIRD_ENABLED:-true}`

── Netbird (peer ephemeral keys for sandboxed runs) ──────────────────

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
nimi nebyla. Naměřeno na riq po nasazení opravy void RPC (kolo 12): každý běh
pluginu v :55 skončil `connect EACCES /var/run/docker.sock` (socket `root:989 660`,
proces `uid=1000 groups=1000`), surová data T-CARS/WD zůstala 0.

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

## `- /var/lib/aisha/agent-runs:/var/lib/aisha/agent-runs:rw`

Per-run git worktrees (claude_cli_task): the runner creates worktrees here
and bind-mounts each into its agent container THROUGH the docker socket, so
the host path must equal the in-container path. It MUST be a literal, not
${VAR}: Coolify rejects '${' in a volume source (command-injection guard),
and the sibling bind-mount only resolves when source==target==a fixed host
path. Keep these literals in sync with AGENT_RUNS_DIR / AGENT_REPO_PATH above.

## `- /srv/aisha/base-repo:/srv/aisha/base-repo:ro`

Read-only base repo the worktrees branch from.

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
