#!/usr/bin/env bash

# Shared helper for Coolify application env metadata.
# Values are synced separately via PATCH /envs/bulk; this helper only flips
# production env metadata so secrets do not leak into build-time parsing.

coolify_buildtime_key_regex() {
  # VERDACCIO_URL zůstává. VERDACCIO_TOKEN odchází (2026-08-18).
  #
  # ⛔ NEJDŘÍV JSEM VYHODIL OBOJE — a byla to CHYBA, kterou odhalil až skutečný
  # build extranetu (`npm error code ERR_INVALID_URL`). Měřil jsem, kdo tu
  # proměnnou konzumuje, ale univerzum měření mělo díru: prošel jsem Dockerfily
  # a compose a MINUL `.npmrc`, který leží v kořeni repa, `.dockerignore` ho
  # nevyřazuje a `COPY . .` ho do každého buildu doveze:
  #
  #     .npmrc:14  @aisha:registry=${VERDACCIO_URL}
  #     .npmrc:15  @aisha:_authToken=${VERDACCIO_TOKEN}
  #
  # npm ty závorky NEROZVINE, když proměnná chybí — vrátí literál
  # `${VERDACCIO_URL}` a padne na neplatné URL při načítání konfigurace, tedy
  # dřív, než se čehokoli dotkne. Brána zdědila díru svého vstupního seznamu.
  #
  # ROZDÍL MEZI TĚMI DVĚMA JE ZMĚŘENÝ, ne odhadnutý:
  #   · prázdná URL   → `npm ci` PADNE (ERR_INVALID_URL)
  #   · prázdný token → `npm view @aisha/extranet-sdk-ui` vrátí 0.3.1
  # Čtení `@aisha/*` je anonymní; token je potřeba jen na publish, a ten běží
  # mimo build. Proto URL (adresa, ne tajemství) zůstává build-time, kdežto
  # token, který by se zapsal do `docker history`, odchází — a kdyby ho registr
  # jednou vyžadoval, build padne nahlas a správná cesta je `--mount=type=secret`.
  #
  # Hlídá brána src/tests/gates/npmrc-registr-musi-mit-adresu.gate.test.ts.
  #
  # ⛔ SENTRY_AUTH_TOKEN ZÚŽENO NA SENTRY_(URL|ORG|PROJECT) (2026-08-18).
  # `Dockerfile.web:180` ho čte přes `--mount=type=secret` — tedy cestou, která
  # se do vrstev ani do historie nezapisuje. Build-time příznak tu ochranu RUŠIL:
  # Coolify tutéž hodnotu poslal navíc jako `--build-arg`. Dvě cesty pro jednu
  # hodnotu, rozhoduje ta slabší. U sesterského FORGEJO_TOKENu se to dodrželo,
  # tady ne — a rozdíl nikdo neměřil. Dnes ano: brána
  # src/tests/gates/secret-nesmi-cestovat-i-jako-build-arg.gate.test.ts odvozuje
  # množinu chráněných klíčů z `--mount=type=secret` + `secrets:` mapování, takže
  # nový secret se pod ni dostane sám. Adresy Sentry (URL/ORG/PROJECT) tajemství
  # nejsou a build-time zůstávají.
  #
  # IMAGE_* (iter 22m, May 2026): compose `image: ${IMAGE_X}` references are
  # resolved at compose-parse time (BEFORE container start) via build-time.env.
  # Without is_buildtime=true Coolify omits them → expansion = "" →
  # "service X has neither an image nor build context: invalid compose project".
  # Caught on aisha-edge wave-2 deploys where mesh-router's `image: ${IMAGE_NETBIRD}`
  # silently became empty despite the value being set in the runtime env.
  #
  # REGISTRY_PROXY (iter 22m): used inline as prefix in IMAGE_X values
  # (e.g. `IMAGE_NETBIRD=${REGISTRY_PROXY}netbirdio/netbird:0.70.0` — config/
  # image-versions.env). Same compose-parse-time requirement.
  #
  # Edge route contract + render-app-config inputs (2026-06-12): the edge
  # "web app" is ALSO a docker-compose stack — `docker compose build` gets only
  # build-time.env (= is_buildtime=true keys) for interpolating the WHOLE file,
  # and the compose carries `${VAR:?}` parse-time guards (gate
  # topology-domains-parity) plus web build.args consumed by Dockerfile.web's
  # render-app-config. Without these flags the fresh-app deploy dies at compose
  # interpolation: "required variable DIRIGENT_DOMAIN is missing a value"
  # (wave 2, first post-wipe deploy 2026-06-12 — old apps only worked off
  # inherited pre-allowlist flags). Keys: (MCP|API|AUTH|DIRIGENT)_DOMAIN(_PUBLIC)?
  # + *_UPSTREAM_(PUBLIC|MESH) + MESH_ENABLED + MATRIX_DOMAIN + KEYCLOAK_REALM.
  # + APP_DOMAIN (2026-08-30) — veřejná tvář webu z topologického resolveru;
  #   generátor statických stránek si z ní odvozuje, čí stránky a značku vyrábí.
  #
  # NETBIRD_(MESH_HOST|MGMT_HOST|DOMAIN|MESH_PORT) (2026-07-09): the mesh-router
  # `extra_hosts` entries (docker-compose.coolify-prebuilt.yml, coolify.yml,
  # -integration.yml, -cosmos.yml) interpolate these at compose-PARSE time:
  #   - "${NETBIRD_MESH_HOST}:${NETBIRD_MGMT_HOST:-host-gateway}"
  # Coolify's build step parses the WHOLE compose with build-time.env only; a
  # runtime-only key interpolates to "" → the entry degenerates to ":host-gateway"
  # → hard schema error `extra_hosts must be a mapping` → EVERY aisha-edge deploy
  # failed validation (incident 2026-07-09; edge silently ran a 3-day-old
  # container). Hostnames/ports only — the NETBIRD_STACK_KEY_* setup keys are
  # SECRETS and stay runtime-only (env-value interpolation tolerates empty).
  #
  # KEYCLOAK_DOMAIN + BACKEND_LAN_IP (2026-07-21): same parse-time rule, for the
  # edge-proxy LAN bypass that lets a MESH-DISABLED multi-server edge reach the
  # backend's INTERNAL-zone vhosts:
  #   - "${API_DOMAIN}:${BACKEND_LAN_IP:-host-gateway}"
  #   - "${KEYCLOAK_DOMAIN}:${BACKEND_LAN_IP:-host-gateway}"
  # API_DOMAIN was already covered by the (MCP|API|AUTH|DIRIGENT)_DOMAIN branch;
  # these two were not, so the entries would have collapsed to ":host-gateway"
  # and hard-failed the compose parse exactly as the 2026-07-09 incident did.
  #
  # NETBIRD_DNS_IP / MESH_TLD / MESH_DNS_RESOLVER_IP (upstream #796, 2026-07-22):
  # the durable single-purpose mesh DNS made these fail-closed (${VAR:?}) on the
  # edge web's dns:/dns_search and mesh-router's ipv4_address pin. Same parse-time
  # rule — a runtime-only key here fails the FIRST deploy with "required variable
  # X is missing a value". Hostnames/IPs, not secrets — safe at build time.
  # NETBIRD_DNS_IP / MESH_TLD / MESH_DNS_RESOLVER_IP (2026-07-22): the durable
  # single-purpose mesh DNS made these fail-closed (${VAR:?}) on the edge web's
  # dns:/dns_search and mesh-router's ipv4_address pin. Coolify parses the whole
  # compose with build-time.env only, so a runtime-only key here fails the FIRST
  # deploy with "required variable X is missing a value". They are hostnames/IPs,
  # not secrets — safe at build time.
  # EXTRANET_(DOMAIN_PUBLIC|UPSTREAM_PUBLIC|OIDC_SECRET|COOKIE_SECRET) (2026-08-04):
  # brána extranetu (služba `extranet-auth` v edge compose) je oauth2-proxy před
  # veřejným povrchem — bez ní server vydá JS bundle komukoli. Compose
  # interpoluje CELÝ soubor bez ohledu na profily, takže její `${VAR:?}` musí
  # projít i při buildu, jinak PRVNÍ deploy čerstvého aisha-edge umře na
  # "required variable EXTRANET_OIDC_SECRET is missing a value".
  #
  # `:?` je tu správně a je vynucené jinou bránou: obě tajemství vyrábí
  # generate-secrets přes pg(), takže prázdná hodnota znamená SELHANÝ push env,
  # ne „brána není chtěná" (viz Compose Secret Hygiene). Kotva `stays anchored`
  # v edge-buildtime-allowlist hlídá jmenovitý seznam citlivých klíčů databáze,
  # JWT a administrace; extranetové klíče v něm nejsou, takže ji rozšíření
  # neporušuje — ověřeno spuštěním té brány.
  # MESH_DNS_SUBNET (2026-08-10): od chvíle, kdy si mesh-DNS síť zakládá COMPOSE
  # (dřív `external: true`), nese deklarace `ipam.config.subnet:
  # ${MESH_DNS_SUBNET:?…}` — a to je interpolace v PARSE fázi, tedy build-time.
  # Bez tohohle klíče čerstvá aplikace umře na "required variable MESH_DNS_SUBNET
  # is missing a value" dřív, než se vůbec něco postaví. Subnet, ne tajemství.
  #
  # MESH_DNS_NETWORK (2026-08-05): jméno mesh-DNS sítě je INSTANČNÍ (vydává ho
  # generate-secrets jako `${deployPrefix}-mesh-dns`) a compose ho čte jako
  # `${MESH_DNS_NETWORK:?…}` — fallback `aisha-mesh-dns` byl jméno implementace
  # a rozcházel se s tím, co cold-start skutečně zakládá. Tím je parse-required:
  # bez téhle položky by první deploy čerstvé appky umřel na "required variable
  # MESH_DNS_NETWORK is missing a value". Jméno sítě, ne tajemství.
  # KEYCLOAK_INTERNAL_URL (2026-08-05): mělo v compose fallback na
  # `http://aisha-keycloak:80` — jméno IMPLEMENTACE stacku. Na SDÍLENÉ síti
  # `coolify` nepatří jedné instanci (změřeno 2026-08-04: 149 aplikací,
  # 8 zákaznických prefixů, pět Keycloaků). A je to adresa, ze které se tahá
  # JWKS: cizí podpisové klíče = 401 na všem. Ne bypass (issuer i audience
  # se ověřují zvlášť), ale výpadek s příznaky autorizační chyby.
  #
  # Fallback padl a zbylo `${VAR:?}` — tím se stalo parse-required. Coolify
  # parsuje CELÝ compose jen s build-time.env, takže bez téhle položky by
  # PRVNÍ deploy čerstvého aisha-edge umřel na "required variable
  # KEYCLOAK_INTERNAL_URL is missing a value". Vnitřní adresa, ne tajemství —
  # build-time bezpečné. Doručení ověřeno: vydává ho derivace.
  #
  # NETBIRD_PEER_CIDR (2026-08-21) je tatáž třída: `${VAR:?}` u edge-proxy
  # i extranet-auth (routa do mesh, `infra/mesh/mesh-client-route.sh`), tedy
  # parse-required. Bez téhle položky by PRVNÍ deploy čerstvé edge aplikace
  # — a to je KAŽDÝ wipe — umřel na "required variable NETBIRD_PEER_CIDR is
  # missing a value". Rozsah peerů je konstanta NetBirdu, ne tajemství.
  #
  # KEYCLOAK_DOMAIN_PUBLIC (2026-09-02, znovu zmereno 2026-09-12): TAZ dira, jen
  # o jeden sufix vedle. Vetev vys ma `(MCP|API|AUTH|DIRIGENT)_(DOMAIN(_PUBLIC)?|...)`,
  # ale keycloaki kotvi `$` hned za `DOMAIN`, takze `_PUBLIC` variantu MINULA --
  # prestoze ji `extra_hosts` interpoluji v 17 compose souborech:
  #   - "${KEYCLOAK_DOMAIN_PUBLIC}:host-gateway"
  # Pri Coolify build-parse (jen build-time.env) by se dosadilo prazdno a compose
  # spadne na `extra_hosts' bad host name ''`. Overeno izolovane: prazdna promenna
  # -> "bad host name ''", DVE STEJNE neprazdne -> "must be a mapping". Jsou to DVE
  # RUZNE vady se dvema lecbami: druhou resi KEYCLOAK_EXTRA_HOST_ALIAS (sentinel
  # `keycloak-alias-disabled.invalid` pri kolapsu zon), tuhle prvni tenhle klic.
  #
  # WEB_RENDER_(STATIC|SHELL)_HOST_DIR (2026-09-24): hostitelské cesty, které
  # edge web montuje jako ZDROJ svazku (výstup rendereru, publikovaná skořápka).
  # Zdroj svazku se interpoluje při PARSOVÁNÍ — a Coolify parsuje edge compose
  # jen s build-time.env. Runtime-only klíč dá prázdný zdroj a compose padne
  # dřív, než se cokoli postaví. Jsou to cesty odvozené z identity instance
  # (generate-secrets), ne tajemství — build-time bezpečné. Hlídá brána
  # edge-buildtime-allowlist (třída: každá proměnná ve zdroji svazku edge).
  printf '%s' '^(VITE_|PUBLIC_SITE_URL$|SENTRY_(URL|ORG|PROJECT)$|GIT_SHA$|VERDACCIO_URL$|IMAGE_|REGISTRY_PROXY$|(MCP|API|AUTH|DIRIGENT)_(DOMAIN(_PUBLIC)?|UPSTREAM_(PUBLIC|MESH))$|EXTRANET_(DOMAIN_PUBLIC|UPSTREAM_PUBLIC|OIDC_SECRET|COOKIE_SECRET)$|MESH_ENABLED$|MATRIX_DOMAIN$|APP_DOMAIN$|KEYCLOAK_(REALM|DOMAIN(_PUBLIC)?|INTERNAL_URL)$|BACKEND_LAN_IP$|NETBIRD_(MESH_HOST|MGMT_HOST|DOMAIN|MESH_PORT|DNS_IP|PEER_CIDR)$|MESH_TLD$|MESH_DNS_NETWORK$|MESH_DNS_SUBNET$|AISHA_DB_IMAGE$|POSTGRES_MAJOR$|MESH_DNS_RESOLVER_IP$|APP_NAME_PREFIX$|SPA_KNOCK_PUBLIC_PORT$|WEB_RENDER_(STATIC|SHELL)_HOST_DIR$|EDGE_ACCESS_RETENTION_DAYS$)'
}

coolify_is_web_build_app() {
  case "$1" in
    aisha-edge|aisha-web|edge|web) return 0 ;;
    *) return 1 ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# KTERÉ KLÍČE TEN COMPOSE OPRAVDU POTŘEBUJE PŘI PARSOVÁNÍ
#
# ⛔ NAMĚŘENO 2026-08-15 živě přes Coolify API napříč všemi 24 buildícími
# aplikacemi:
#
#     potřebných při buildu:   101
#     zbytečně poslaných:      983   (z toho 229 tajemství, 139 různých)
#
# Dvacet z 24 aplikací potřebuje při buildu JEDNU hodnotu a dostane 20–60.
# Vystaveno bylo mj. COOLIFY_API_KEY, ANTHROPIC_API_KEY (5×), hesla Appsmithu,
# Grafany, ClickHouse. Build arg se zapisuje do metadat obrazu — `docker history`
# ho vydá komukoli, kdo na obraz dosáhne, a napořád.
#
# PŘÍČINA NENÍ NEDBALOST: `is_buildtime` řídí DVĚ věci najednou —
#   (1) hodnota se dostane do `build-time.env` pro INTERPOLACI COMPOSE,
#   (2) Coolify vloží `ARG <KEY>` za každý `FROM` (modify_dockerfiles_for_compose),
#       čímž se hodnota zapeče do obrazu.
# Chceme (1), ne (2), a řídí je týž bit. Proto tu stálo `else true`: raději vše,
# než aby deploy umřel na "required variable X is missing a value".
#
# ODVOZENO, BEZ JEDINÉHO SEZNAMU. Rozhoduje POZICE v souboru, ne jméno klíče:
#
#   · `${VAR:?}` kdekoli            → parse SELŽE, když hodnota chybí
#   · cokoli MIMO blok `environment:` → strukturální pozice (`image:`, `name:`,
#     `ipam.subnet:`, `ipv4_address:`, `ports:`, `extra_hosts:`, `dns:`,
#     `build.args`, cesty svazků…). Prázdno tam parse rozbije nebo změní tvar.
#   · uvnitř `environment:` bez `:?` → prázdno je NEŠKODNÉ. Build-parse a
#     up-parse jsou DVA různé běhy s různým env; runtime si Coolify interpoluje
#     zvlášť, takže hodnota nemusí být v build-time.env vůbec.
#
# ⛔ PROČ NE „všechno, co compose zmíní": změřeno na aisha-edge — široké
# odvození dá 154 klíčů proti dnešním 64, tedy expozici ZVĚTŠÍ. Rozdíl jsou
# přesně `environment:` hodnoty, které parse tolerují prázdné.
#
# DŮKAZ ÚPLNOSTI (docker-compose.coolify-prebuilt.yml): tohle pravidlo najde 65
# klíčů, ručně pěstovaný seznam pokrýval 64 — a obě odchylky jsou OPRAVY:
#   · `NETBIRD_MESH_PORT`      seznam vyžadoval zbytečně (`environment:` s `:-`)
#   · `GATEWAY_DOMAIN_PUBLIC`  seznam MINUL, přitom stojí v `build.args`
# Dvě položky seznamu byly navíc zastaralé — a 2026-08-18 z něj VYPADLY (viz
# zdůvodnění u `coolify_buildtime_key_regex` výš): `VERDACCIO_(TOKEN|URL)` už
# žádný Dockerfile nedeklaruje (`services/svc-push/Dockerfile:6` — „NO Verdaccio"),
# a `SENTRY_AUTH_TOKEN` má být podle #920 runtime-only — seznam ho držel
# build-time, čímž #920 MAŘIL. Tenhle odstavec zůstává jako záznam o tom, že
# odvození obě odchylky NAŠLO dřív, než je někdo opravil ručně.
#
# `secrets: X: environment: NAME` se ZÁMĚRNĚ nepočítá: tak dnes chodí
# FORGEJO_TOKEN a SENTRY_AUTH_TOKEN a #920 je měřením prohlásil za runtime-only.
#
# $1 = cesta k compose (relativně k repu), $2 = JSON pole envů z API
# Tiskne jména klíčů, jedno na řádek. Prázdný výstup = nepodařilo se odvodit.
coolify_parse_required_keys() {
  local compose="$1" envs="$2"
  [ -f "$compose" ] || return 1

  # Semínko podle POZICE — se dvěma opravami, které vypadaly jako opatrnost,
  # ale byly to slepé skvrny (obě naměřeny 2026-08-16, obě ověřeny orákulem
  # `scripts/compose-buildtime-oracle.sh`):
  #
  # 1. `$$` SE ROZLIŠUJE. Dřív ne, s odůvodněním „zahrnout klíč navíc stojí
  #    bajt, vynechat potřebný stojí nasazení". U `$$` ta nesymetrie NEPLATÍ:
  #    `$${VAR}` compose převádí na literál `${VAR}` a hodnotu nehledá — tedy
  #    ho vynechat NEMŮŽE nic rozbít, zatímco zahrnout ho stojí TAJEMSTVÍ
  #    v `docker history`. Přesně takhle se do buildu dostávaly `NB_SETUP_KEY`
  #    (6×), `PKI_CLIENT_KEY_B64`, `NETBIRD_INTERNAL_KEY_B64` a
  #    `OPENXPKI_OPERATOR_PASSWORD_HASH` — všechny čtené až za běhu skriptem
  #    uvnitř `command:`, přesně jak §3c COOLIFY_COMPOSE_RULES předepisuje.
  #    Pravidlo trestalo správně napsaný compose.
  #
  # 2. `environment: &kotva` JE POŘÁD `environment:`. Vzor hlídal jen holé
  #    `environment:` na konci řádku, takže kotvený blok v
  #    `docker-compose.coolify.yml` (`environment: &svc-env`) spadl do větve
  #    „mimo environment" a `POSTGRES_PASSWORD`, `REDIS_PASSWORD` i
  #    `INTERNAL_API_KEY` šly do buildu jen proto, že ten blok má jméno.
  local seed
  seed=$(awk '
    # `$$` je ESCAPE: compose ho vydá jako literální `$` a nic neinterpoluje.
    # Nahradí se znakem, který se do vzorů netrefí — zbylé `${` jsou pak
    # skutečné interpolace. gsub jde zleva a nepřekrývá se, takže `$$${VAR}`
    # správně zůstane interpolací.
    function bez_escapu(s) { gsub(/\$\$/, "\001", s); return s }
    function jmena(s,   out) {
      out = ""
      while (match(s, /\$\{[A-Za-z_][A-Za-z0-9_]*/)) {
        out = out substr(s, RSTART + 2, RLENGTH - 2) "\n"
        s = substr(s, RSTART + RLENGTH)
      }
      return out
    }
    {
      radek = bez_escapu($0)
      odsaz = match($0, /[^ ]/) - 1
      if (odsaz < 0) odsaz = 0

      # Konec bloku environment: dedent na jeho úroveň nebo míň.
      if (v_env && $0 ~ /[^ ]/ && odsaz <= env_odsaz) v_env = 0

      # Fail-closed `${VAR:?}` platí VŽDY, i uvnitř environment:.
      s = radek
      while (match(s, /\$\{[A-Za-z_][A-Za-z0-9_]*:\?/)) {
        printf "%s\n", substr(s, RSTART + 2, RLENGTH - 4)
        s = substr(s, RSTART + RLENGTH)
      }

      if ($0 ~ /^[ ]*environment:[ ]*(&[A-Za-z0-9_.-]+)?[ ]*$/) { v_env = 1; env_odsaz = odsaz; next }
      if (v_env) next          # hodnoty prostředí prázdno tolerují

      printf "%s", jmena(radek)
    }
  ' "$compose" 2>/dev/null | sed '/^$/d' | sort -u)
  [ -z "$seed" ] && return 1

  # Tranzitivní uzávěr přes HODNOTY: je-li klíč potřeba a jeho hodnota odkazuje
  # na jiný, je potřeba i ten. Fixní bod, ne jedno kolo — řetěz může být delší.
  # `-r`: jména se tisknou HOLÁ. Bez toho vrací jq JSON řetězce v uvozovkách,
  # volající by je porovnával jako `"KLIC"` proti `KLIC`, netrefil by ani jeden
  # a všechno by spadlo do runtime-only — tedy ROZBITÝ DEPLOY, ne jen menší
  # expozice. Chyceno při prvním živém běhu.
  printf '%s\n' "$seed" | jq -r -R -s --argjson envs "$envs" '
    (split("\n") | map(select(length > 0))) as $seed
    | ($envs | map({ (.key): (.value // "") }) | add // {}) as $hodnoty
    | def krok($set):
        ($set
         | map($hodnoty[.] // "")
         | join("\n")
         | [scan("\\$\\{([A-Za-z_][A-Za-z0-9_]*)")]
         | flatten) as $nove
        | ($set + $nove | unique);
      def uzavri($set):
        krok($set) as $dalsi
        | if ($dalsi | length) == ($set | length) then $set else uzavri($dalsi) end;
      uzavri($seed | unique)
    | .[]
  ' 2>/dev/null
}

# ─────────────────────────────────────────────────────────────────────────────
# COMPOSE NENÍ CELÁ PRAVDA O TOM, CO BUILD POTŘEBUJE
#
# ⛔ NAMĚŘENO 2026-08-16 živě, PŘED zápisem: zúžení podle compose by aplikaci
# `aisha-core` sebralo `GATEWAY_DOMAIN_PUBLIC`. V compose se ten klíč nevyskytuje
# — ale `Dockerfile.web`, který ten stack staví, ho deklaruje jako
# `ARG GATEWAY_DOMAIN_PUBLIC=` a Coolify ho dodává TÍM, že klíč je build-time.
# (Coolify vkládá `ARG <KEY>` za každý `FROM` pro každý build-time klíč — viz
# `modify_dockerfiles_for_compose`.) Bez příznaku by ARG dostal svou prázdnou
# výchozí hodnotu a build by NESELHAL: jen by zapekl prázdnou adresu. Tichá vada.
#
# Třetí zdroj pravdy je tedy Dockerfile — a bere se JEN z těch, které ten
# konkrétní compose opravdu staví (`build: dockerfile:`). Široký sken všech
# Dockerfilů v repu dá falešné poplachy: `Dockerfile.web` deklaruje
# `ARG REGISTRY_DOMAIN`, ale `aisha-registry` nestaví vůbec nic.
#
# BEZPEČNOST: přidávají se jména ARGŮ, ne tajemství. Tajemství se do buildu
# doručuje `--mount=type=secret` (viz `coolify_buildkit_secret_keys`), a ten
# zákaz je PRVNÍ větev rozhodnutí, takže případný průnik přebije.
#
# $1 = cesta k compose. Tiskne jména klíčů, jedno na řádek.
coolify_dockerfile_arg_keys() {
  local compose="$1"
  [ -f "$compose" ] || return 0
  local root="${COOLIFY_REPO_ROOT:-$PWD}" df
  # `dockerfile:` hodnoty jsou v tomhle repu relativní ke kořeni (context: .).
  # Kdyby některá nebyla, soubor se prostě nenajde a nic se nepřidá — mlčky,
  # protože pravidlo je NADMNOŽINA: chybějící ARG se dohledá až incidentem.
  while IFS= read -r df; do
    [ -z "$df" ] && continue
    [ -f "$root/$df" ] || continue
    grep -E '^[[:space:]]*ARG[[:space:]]+[A-Za-z_]' "$root/$df" 2>/dev/null \
      | sed -E 's/^[[:space:]]*ARG[[:space:]]+//; s/=.*//; s/[[:space:]]*$//'
  done < <(grep -oE 'dockerfile:[[:space:]]*[^[:space:]]+' "$compose" 2>/dev/null \
             | sed -E 's/dockerfile:[[:space:]]*//' | sort -u) \
    | sed '/^$/d' | sort -u
}

# ─────────────────────────────────────────────────────────────────────────────
# CO SE DORUČUJE JAKO BUILDKIT SECRET, NESMÍ BÝT BUILD-TIME. NIKDY.
#
# ⛔ NAMĚŘENO 2026-08-16: PR #920 přesunul `FORGEJO_TOKEN` a `SENTRY_AUTH_TOKEN`
# z build argů na `--mount=type=secret`, protože build arg končí v metadatech
# obrazu a `docker history` ho vydá napořád. Jenže env metadata zůstala
# nedotčená, takže Coolify ty hodnoty DÁL posílá jako `--build-arg` a vkládá
# `ARG <KEY>` za každý `FROM`:
#
#     FORGEJO_TOKEN      core, keycloak → build-time (větev `else true`)
#     SENTRY_AUTH_TOKEN  core           → build-time (větev `else true`)
#     SENTRY_AUTH_TOKEN  edge           → build-time (ruční seznam)
#
# Bezpečnostní oprava tedy byla bez účinku na KAŽDÉ aplikaci, která s těmi
# tokeny staví. Dockerfily se změnily, cesta doručení ne.
#
# Zdroj pravdy je compose sám: `secrets: <jmeno>: environment: KLIC` znamená
# „tuhle hodnotu bere build jako secret". Takový klíč se čte z prostředí
# projektu za běhu buildu — build-time příznak k tomu není potřeba a jen ji
# zapeče. Žádný ručně udržovaný seznam: přibude-li další secret, chytí se sám.
#
# $1 = cesta k compose. Tiskne jména klíčů, jedno na řádek.
coolify_buildkit_secret_keys() {
  local compose="$1"
  [ -f "$compose" ] || return 0
  awk '
    /^secrets:[[:space:]]*$/ { s = 1; next }
    s && /^[A-Za-z]/         { s = 0 }
    s && $1 == "environment:" { print $2 }
  ' "$compose" 2>/dev/null | sed 's/[",]//g' | sed '/^$/d' | sort -u
}

coolify_normalize_buildtime_envs() {
  local api_base="$1"
  local token="$2"
  local app_uuid="$3"
  local app_name="$4"
  local dry_run="${5:-0}"

  local buildtime_regex
  buildtime_regex="$(coolify_buildtime_key_regex)"

  local web_app=false
  if coolify_is_web_build_app "$app_name"; then
    web_app=true
  fi

  # Read envs with retry — large stacks (aisha-core: ~85KB, 71+ envs) can
  # time out under Coolify load. Without retry the whole sync aborts even
  # though the env VALUES were already successfully written. Buildtime
  # metadata normalization is meta-only; transient timeouts must not
  # propagate as fatal.
  local envs=""
  local read_attempt
  for read_attempt in 1 2 3; do
    envs=$(curl -sS --http1.1 --max-time 60 --connect-timeout 10 \
      -H "Authorization: Bearer ${token}" \
      -H "Accept: application/json" \
      "${api_base}/applications/${app_uuid}/envs" 2>/dev/null | tr -d '\000-\037')
    if echo "$envs" | jq -e 'type == "array"' >/dev/null 2>&1; then
      break
    fi
    if [ "$read_attempt" -lt 3 ]; then
      echo "  buildtime flags: read timeout for ${app_name} (attempt ${read_attempt}/3) — retrying in $((read_attempt * 5))s..." >&2
      sleep $((read_attempt * 5))
    fi
  done

  if ! echo "$envs" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "  buildtime flags: failed to read envs for ${app_name} after 3 attempts (transient API timeout — env values were synced, only metadata refresh skipped)" >&2
    # Soft-fail: env VALUES are already in place (set via prior bulk PATCH).
    # Buildtime flags can be re-normalized on next sync run. Returning 0
    # avoids aborting cold-start over a transient read.
    return 0
  fi

  # Které klíče ten stack při parsování compose OPRAVDU potřebuje. Cesta ke
  # compose se bere z Coolify (`docker_compose_location`) — je to táž hodnota,
  # podle které Coolify staví, takže se neptáme na jiný soubor, než jaký se
  # nasazuje.
  # Cesta ke compose té aplikace — bere se z Coolify (`docker_compose_location`),
  # tedy z téže hodnoty, podle které Coolify staví. Potřebují ji OBA výpočty
  # níž, proto se čte i pro web aplikace.
  local app_meta compose_rel compose_path
  app_meta=$(curl -sS --http1.1 --max-time 30 --connect-timeout 10 \
    -H "Authorization: Bearer ${token}" -H "Accept: application/json" \
    "${api_base}/applications/${app_uuid}" 2>/dev/null | tr -d '\000-\037')
  compose_rel=$(printf '%s' "$app_meta" | jq -r '.docker_compose_location // ""' 2>/dev/null)
  compose_path="${COOLIFY_REPO_ROOT:-$PWD}/${compose_rel#/}"

  # ZÁKAZ, KTERÝ PŘEBÍJÍ VŠECHNO: klíče doručované jako BuildKit secret.
  # Bez tohohle byla oprava #920 bez účinku — viz komentář u
  # `coolify_buildkit_secret_keys`.
  local buildkit_secrets='[]'
  if [ -f "$compose_path" ]; then
    local bs
    bs=$(coolify_buildkit_secret_keys "$compose_path")
    [ -n "$bs" ] && buildkit_secrets=$(printf '%s\n' "$bs" | jq -R -s 'split("\n") | map(select(length > 0))')
  fi

  local parse_required='[]'
  if [ "$web_app" = "false" ]; then
    local derived dockerargs
    if [ -n "$compose_rel" ] && [ -f "$compose_path" ]; then
      # DVA zdroje, ne jeden: co compose potřebuje při parsování PLUS co čeká
      # `ARG` v Dockerfilech, které ten compose staví. Druhý zdroj v compose
      # vidět NENÍ — Coolify ho dodává právě build-time příznakem.
      derived=$(coolify_parse_required_keys "$compose_path" "$envs")
      dockerargs=$(coolify_dockerfile_arg_keys "$compose_path")
      derived=$(printf '%s\n%s\n' "$derived" "$dockerargs" | sed '/^$/d' | sort -u)
      if [ -n "$derived" ]; then
        parse_required=$(printf '%s\n' "$derived" | jq -R -s 'split("\n") | map(select(length > 0))')
      fi
    fi
    # ⚠ MLČENÍ TU NENÍ NA MÍSTĚ. Nepodaří-li se odvodit, chová se to jako dřív
    # (všechno build-time) — ale operátor to MUSÍ vědět, protože tichý návrat
    # k plné expozici vypadá k nerozeznání od úspěchu.
    if [ "$parse_required" = "[]" ]; then
      echo "  buildtime flags: ⚠ ${app_name} — nepodařilo se odvodit z compose (${compose_rel:-bez cesty}); " \
           "ponechávám VŠE build-time jako dřív, tedy i tajemství" >&2
    fi
  fi

  # Logic:
  #   - For web apps (Dockerfile build): ONLY VITE_/PUBLIC_SITE_URL/SENTRY_/GIT_SHA
  #     should be build-time (passed as ARG into docker build).
  #   - For non-web apps (docker-compose stacks): ALL non-preview keys must be
  #     build-time, because Coolify generates build-time `.env` for compose
  #     interpolation. Without buildtime=true, compose deploy fails with
  #     "required variable X is missing a value".
  # CRITICAL: the PATCH payload must carry the CURRENT value — Coolify's
  # PATCH /applications/{uuid}/envs treats a missing `value` field as ""
  # and WIPES the production row (the preview copy survives). A meta-only
  # payload here is what produced the empty-prod/filled-preview asymmetry
  # that killed first post-wipe edge deploys (observed 2026-06-11/12:
  # MATRIX_DOMAIN/DIRIGENT_DOMAIN prod rows emptied right after the value
  # sync, because the flag flip ran second and dropped them).
  local updates
  updates=$(echo "$envs" | jq -c \
    --argjson web_app "$web_app" \
    --argjson parse_required "$parse_required" \
    --argjson buildkit_secrets "$buildkit_secrets" \
    --arg buildtime_regex "$buildtime_regex" '
      .[]
      # PREVIEW SE NORMALIZUJE TAKÉ. Dřív tu stálo `select(is_preview == false)`
      # bez odůvodnění — a protože Coolify vede pro každý klíč SAMOSTATNÝ řádek
      # pro produkci a pro preview, srovnala se jen půlka. Naměřeno 2026-09-02 na
      # <fork>-core: po normalizaci zbylo 228 build-time záznamů, z toho 172
      # preview — včetně SENTRY_AUTH_TOKENu a FORGEJO_TOKENu, které mají produkční
      # řádek `false` a preview `true`. Preview build je build jako každý jiný:
      # zapeče `--build-arg` do `docker history` úplně stejně.
      | . as $env
      | (if ($env.key | IN($buildkit_secrets[]))
           # BuildKit secret NIKDY nesmí být build-time — jinak ho Coolify
           # pošle jako `--build-arg` a vloží `ARG` za každý `FROM`, čímž
           # skončí v `docker history`. Tenhle zákaz přebíjí i ruční seznam.
           then false
         elif $web_app
           then ($env.key | test($buildtime_regex))
         elif ($parse_required | length) > 0
           # ODVOZENO ∪ SEZNAM: build-time dostane jen to, co compose opravdu
           # interpoluje (tranzitivně přes hodnoty), plus kronika incidentů
           # jako podlaha. Zbytek zůstane runtime-only a do metadat obrazu
           # se nedostane.
           then (($env.key | IN($parse_required[])) or ($env.key | test($buildtime_regex)))
           else true
         end) as $target
      | select((.is_buildtime // false) != $target)
      # is_preview se NESE z původního řádku — jinak by PATCH preview záznamu
      # mířil na produkční a tiše ho přepsal (dva řádky, jeden klíč).
      | { key: $env.key, value: ($env.value // ""), is_preview: ($env.is_preview // false), is_buildtime: $target }
    ')

  if [ -z "$updates" ]; then
    echo "  buildtime flags: already normalized"
    return 0
  fi

  if [ "$dry_run" = "1" ]; then
    local count
    count=$(printf '%s\n' "$updates" | sed '/^$/d' | wc -l | tr -d ' ')
    echo "  buildtime flags: would update ${count} env metadata record(s)"
    printf '%s\n' "$updates" | sed -n '1,20p' | jq -r '"    " + .key + " -> " + (.is_buildtime|tostring)'
    return 0
  fi

  local failed=0
  local count=0
  local payload key response curl_rc attempt
  while IFS= read -r payload; do
    [ -z "$payload" ] && continue
    key=$(echo "$payload" | jq -r '.key')
    response=""
    curl_rc=0
    for attempt in 1 2 3; do
      if response=$(curl -sS --http1.1 --max-time 30 --connect-timeout 10 \
        --retry 2 --retry-delay 2 --retry-all-errors --retry-connrefused \
        -X PATCH \
        -H "Authorization: Bearer ${token}" \
        -H "Accept: application/json" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        "${api_base}/applications/${app_uuid}/envs" | tr -d '\000-\037'); then
        curl_rc=0
      else
        curl_rc=$?
      fi
      if [ "$curl_rc" -eq 0 ]; then
        break
      fi
      sleep $((attempt * 2))
    done

    if [ "$curl_rc" -ne 0 ]; then
      response="{\"error\":\"curl exit ${curl_rc}\"}"
    fi

    if echo "$response" | jq -e --arg key "$key" '(.uuid and .key == $key) or (type == "boolean" and . == true)' >/dev/null 2>&1; then
      count=$((count + 1))
    else
      echo "  buildtime flags: failed to update ${key}: $(echo "$response" | jq -c '.message // .error // .' 2>/dev/null || echo "$response")" >&2
      failed=1
    fi
  done <<< "$updates"

  if [ "$failed" -ne 0 ]; then
    return 1
  fi

  echo "  buildtime flags: normalized ${count} env metadata record(s)"
}
