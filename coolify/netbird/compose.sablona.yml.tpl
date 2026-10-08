# GENEROVÁNO scripts/gen-netbird-instance.mjs ze šablony coolify/netbird/*.tpl a deklarace config/netbird-instances.json — NEEDITOVAT RUČNĚ.
# Próza: docs/compose-notes/docker-compose.coolify-netbird.yml.md (soubor jde na server jako argument příkazu a soutěží s ARG_MAX).
# Vysvětlení patří tam, ukotvené k řádku; změna konfigurace patří do šablony nebo deklarace.
x-netbird-common: &netbird-common
  restart: unless-stopped
  networks:
    - internal

services:
{{#vnitrni_tls}}
  pki-init:
    build:
      context: .
      dockerfile: Dockerfile.pki-init
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}--pki-init
    restart: "no"
    command: ["/usr/local/bin/issue-netbird-mesh-cert.sh"]
    environment:
      NETBIRD_MESH_HOST: ${{{E}}_MESH_HOST}
      PKI_BRIDGE_URL: ${PKI_BRIDGE_URL}
      PKI_BUNDLE_REQUIRED: ${PKI_BUNDLE_REQUIRED:?odvozuje cold-start z manifestu; bez něj pki-init trvá na bundlu i bez PKI}
      KEYCLOAK_URL: ${KEYCLOAK_INTERNAL_URL:?pki-init volá Keycloak VNITŘNĚ (http://<prefix>-keycloak:80) — jméno z jiné sítě se nerozliší a skončí venku}
      KEYCLOAK_REALM: ${KEYCLOAK_REALM:?realm je identita instance, nedosazuje se}
      PKI_BOOTSTRAP_CLIENT_ID: ${PKI_BOOTSTRAP_CLIENT_ID:?PKI_BOOTSTRAP_CLIENT_ID must be delivered by cold-start env — the client constant lives in keycloak/aisha-realm.json}
      PKI_BOOTSTRAP_CLIENT_SECRET: ${AISHA_PKI_BOOTSTRAP_CLIENT_SECRET:-}
      PKI_BOOTSTRAP_USERNAME: ${PKI_BOOTSTRAP_USERNAME:?PKI_BOOTSTRAP_USERNAME must be delivered by cold-start env — the client constant lives in keycloak/aisha-realm.json}
      PKI_BOOTSTRAP_PASSWORD: ${AISHA_PKI_BOOTSTRAP_PASSWORD:-}
      RENEW_THRESHOLD_DAYS: ${RENEW_THRESHOLD_DAYS:-7}
    volumes:
      - pki-certs:/certs/pki
    healthcheck:
      disable: true
    labels:
      - "traefik.enable=false"
      - "traefik.docker.network=coolify"
    networks:
      - internal

{{/vnitrni_tls}}
  {{T}}-db:
    build:
      context: .
      dockerfile: Dockerfile.netbird-db
      args:
        REGISTRY_PROXY: ${REGISTRY_PROXY:-}
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: netbird
      POSTGRES_USER: netbird_app
      POSTGRES_PASSWORD: ${{{E}}_DB_PASSWORD:?{{E}}_DB_PASSWORD required}
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - {{T}}-db-data-v5:/var/lib/postgresql/data
    expose:
      - "5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U netbird_app -d netbird"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 30s
    networks:
      internal:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}-db
    labels:
      - "coolify.managed=true"

  {{T}}-init:
    build:
      context: .
      dockerfile: Dockerfile.netbird-init
{{#vlastni_sablona}}
      args:
        NETBIRD_MGMT_SABLONA: {{MGMT_SABLONA}}
{{/vlastni_sablona}}
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}-init
    restart: "no"
    command:
      - sh
      - -c
      - |
        set -e
        envsubst < /staging/management.json.template > /config/management.json
        chmod 0644 /config/management.json
        echo "[netbird-init] management.json rendered ($(wc -c </config/management.json) bytes)"
    environment:
      KEYCLOAK_DOMAIN_PUBLIC: ${KEYCLOAK_DOMAIN_PUBLIC}
      KEYCLOAK_URL_FROM_CLUSTER: ${KEYCLOAK_INTERNAL_URL:?management ověřuje tokeny VNITŘNĚ (http://<prefix>-keycloak:80) — přes vnitřní jméno s https neexistuje ověřitelný certifikát a odmítne KAŽDÝ token}
      KEYCLOAK_REALM: ${KEYCLOAK_REALM:?realm vydává topologie; prázdno by envsubst tiše dosadil do všech adres v management.json}
      NETBIRD_DOMAIN: ${{{E}}_DOMAIN}
{{#vnitrni_tls}}
      NETBIRD_MESH_HOST: ${{{E}}_MESH_HOST}
      NETBIRD_MESH_PORT: ${{{E}}_MESH_PORT:-33073}
{{/vnitrni_tls}}
      NETBIRD_OIDC_CLIENT_ID: ${{{E}}_OIDC_CLIENT_ID{{Z_OIDC}}}
      NETBIRD_MGMT_SECRET: ${{{E}}_MGMT_SECRET}
      NETBIRD_RELAY_SECRET: ${{{E}}_RELAY_SECRET}
      NETBIRD_DATASTORE_ENC_KEY: ${{{E}}_DATASTORE_ENC_KEY:?{{E}}_DATASTORE_ENC_KEY required for management.json (must be standard base64)}
{{#stun_turn}}
      NETBIRD_TURN_USERNAME: ${{{E}}_TURN_USERNAME}
      NETBIRD_TURN_PASSWORD: ${{{E}}_TURN_PASSWORD}
{{/stun_turn}}
    volumes:
      - {{T}}-config-v5:/config
    healthcheck:
      disable: true
    networks:
      - internal

  {{T}}-management:
    <<: *netbird-common
    build:
      context: .
      dockerfile: Dockerfile.netbird-runtime
      args:
        NETBIRD_BASE_IMAGE: ${IMAGE_NETBIRD_MANAGEMENT{{Z_IMG_MGMT}}}
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}--management
    depends_on:
      {{T}}-db:
        condition: service_healthy
      {{T}}-init:
        condition: service_completed_successfully
    command:
      - --port=443
      - --log-file=console
      - --log-level=info
      - --disable-anonymous-metrics=true
      - --single-account-mode-domain=${{{E}}_DOMAIN}
      - --dns-domain=${{{DNS}}}
    environment:
      AUTH_CLIENT_ID: ${{{E}}_OIDC_CLIENT_ID{{Z_OIDC}}}
      AUTH_AUDIENCE: ${{{E}}_OIDC_CLIENT_ID{{Z_OIDC}}}
      AUTH_CLIENT_SECRET: ${{{E}}_OIDC_SECRET}
      AUTH_AUTHORITY: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}
      AUTH_SUPPORTED_KID_ALGS: RS256
      NETBIRD_IDP_MANAGER_TYPE: keycloak
      NETBIRD_IDP_MANAGER_CLIENT_ID: {{IDP}}
      NETBIRD_IDP_MANAGER_CLIENT_SECRET: ${{{E}}_MGMT_SECRET}
      NETBIRD_IDP_MANAGER_KEYCLOAK_BASE_URL: https://${KEYCLOAK_DOMAIN_DIRECT:?topologie ji emituje pro KAŽDÝ profil (cloud-multi/cloud-single/local-dev) — bez ní management nestáhne JWKS a odmítne každý token}
      NETBIRD_IDP_MANAGER_KEYCLOAK_REALM: ${KEYCLOAK_REALM:?realm je DEKLAROVANÁ konstanta (keycloak/*-realm.json), ne literál ve stack kódu — doručuje cold-start env}
      NB_STORE_ENGINE: postgres
      NB_STORE_ENGINE_POSTGRES_DSN: postgres://netbird_app:${{{E}}_DB_PASSWORD}@${APP_NAME_PREFIX:?identita instance}-{{T}}-db:5432/netbird?sslmode=disable
{{#stun_turn}}
      NETBIRD_TURN_DOMAIN: ${{{E}}_DOMAIN}
      NETBIRD_TURN_USERNAME: ${{{E}}_TURN_USERNAME}
      NETBIRD_TURN_PASSWORD: ${{{E}}_TURN_PASSWORD}
{{/stun_turn}}
      NETBIRD_RELAY_AUTH_SECRET: ${{{E}}_RELAY_SECRET}
    volumes:
      - {{T}}-mgmt-v5:/var/lib/netbird
      - {{T}}-config-v5:/etc/netbird:ro
    expose:
      - "443"
      - "10000"
    healthcheck:
      test: ["CMD", "/bin/busybox", "nc", "-z", "127.0.0.1", "443"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
    networks:
      coolify:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}-management
      internal:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}-management
    labels:
      - "coolify.managed=true"

  {{T}}-signal:
    <<: *netbird-common
    build:
      context: .
      dockerfile: Dockerfile.netbird-runtime
      args:
        NETBIRD_BASE_IMAGE: ${IMAGE_NETBIRD_SIGNAL{{Z_IMG_SIGNAL}}}
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}--signal
    command:
      - --log-level=info
      - --log-file=console
    volumes:
      - {{T}}-signal-v5:/var/lib/netbird-signal
    expose:
      - "10000"
    healthcheck:
      test: ["CMD", "/bin/busybox", "nc", "-z", "127.0.0.1", "10000"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 10s
    networks:
      coolify:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}-signal
      internal:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}-signal
    labels:
      - "coolify.managed=true"

  {{T}}-dashboard:
    <<: *netbird-common
    image: ${IMAGE_NETBIRD_DASHBOARD}
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}--dashboard
    environment:
      AUTH_AUTHORITY: https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}
      AUTH_CLIENT_ID: ${{{E}}_OIDC_CLIENT_ID{{Z_OIDC}}}
      AUTH_AUDIENCE: ${{{E}}_OIDC_CLIENT_ID{{Z_OIDC}}}
      AUTH_SUPPORTED_KID_ALGS: RS256
      AUTH_SUPPORTED_SCOPES: "openid profile email offline_access api"
      AUTH_REDIRECT_URI: https://${{{E}}_DOMAIN}/auth
      AUTH_SILENT_REDIRECT_URI: https://${{{E}}_DOMAIN}/silent-auth
      NETBIRD_MGMT_API_ENDPOINT: https://${{{E}}_DOMAIN}
      NETBIRD_MGMT_GRPC_API_ENDPOINT: https://${{{E}}_DOMAIN}
      USE_AUTH0: "false"
    expose:
      - "80"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost:80/ || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 15s
    networks:
      internal:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}-dashboard
    labels:
      - "coolify.managed=true"

  {{T}}-relay:
    <<: *netbird-common
    build:
      context: .
      dockerfile: Dockerfile.netbird-runtime
      args:
        NETBIRD_BASE_IMAGE: ${IMAGE_NETBIRD_RELAY{{Z_IMG_RELAY}}}
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}--relay
    environment:
      NB_LOG_LEVEL: info
      NB_LISTEN_ADDRESS: ":33080"
      NB_EXPOSED_ADDRESS: "rels://${{{E}}_DOMAIN}:443/relay"
      NB_AUTH_SECRET: ${{{E}}_RELAY_SECRET}
    expose:
      - "33080"
    healthcheck:
      test: ["CMD", "/bin/busybox", "nc", "-z", "127.0.0.1", "33080"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 10s
    labels:
      - "coolify.managed=true"
    networks:
      internal:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}-relay

  {{T}}-proxy:
    <<: *netbird-common
    image: ${REGISTRY_PROXY}library/caddy:2.8.4-alpine
    environment:
      GATEWAY_TRUSTED_PROXIES: ${GATEWAY_TRUSTED_PROXIES:-}
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}--proxy
    expose:
      - "80"
    entrypoint:
      - /bin/sh
      - -c
      - |
        mkdir -p /etc/caddy
        # ⛔ NAMĚŘENO 2026-09-01: Caddy bez `trusted_proxies` příchozímu
        # `x-forwarded-for` NEDŮVĚŘUJE a přepíše ho adresou souseda. HAProxy na
        # pfSense hlavičku nastavuje autoritativně (`del-header` + `set-header
        # X-Forwarded-For %[src]`), takže klientská adresa k nám dorazí — a náš
        # skok ji zahodil. Seznam je TÝŽ, jaký dostává gateway; nedoručený se
        # hlásí NAHLAS a Caddyfile se staví bez něj (prázdný `static` by Caddy
        # neustartoval).
        # ⛔ JEDEN globální blok, a musí být PRVNÍ. Caddy druhý `{` neumí odlišit
        # od bloku bez adresy a skončí hláškou „server block without any key" —
        # ta pojmenovává příznak, ne příčinu, takže vede hledání jinam.
        #
        # ⛔ NAMĚŘENO 2026-09-02. `trusted_proxies` se emitoval PODMÍNĚNĚ jako
        # první blok, `protocols` VŽDY jako druhý. Konfigurace se tedy rozbila
        # PRÁVĚ TEHDY, KDYŽ BYL SEZNAM DORUČENÝ — čím správněji nastaveno, tím
        # hůř. A protože ten seznam vyžadují DVEŘE, jejich zapnutí shodilo
        # řídicí rovinu meshe: agenti se po restartu neměli kde přihlásit,
        # mesh jména přestala existovat a edge vracel 502 na všechno.
        #
        # Oba parametry proto emituje JEDEN blok; nedoručený seznam ubere
        # řádek, nikdy nepřidá blok.
        {
          printf '{\n  servers {\n'
          if [ -n "$${GATEWAY_TRUSTED_PROXIES:-}" ]; then
            printf '    trusted_proxies static %s\n' "$$(echo "$${GATEWAY_TRUSTED_PROXIES}" | tr ',' ' ')"
          else
            echo "[caddy] GATEWAY_TRUSTED_PROXIES NEDORUČEN — x-forwarded-for bude PŘEPSÁN" >&2
          fi
          printf '    protocols h1 h2 h2c\n  }\n}\n\n'
        } > /etc/caddy/Caddyfile
        cat >> /etc/caddy/Caddyfile <<'CADDY'
        :80 {
          # Local liveness — never depends on upstreams.
          handle /__netbird_health {
            respond "ok" 200
          }

          # Management REST API. netbird management serves REST + gRPC on one
          # h2c port (cmux). Canonical idiom (same as netbird-internal-tls):
          # bare upstream + transport block — `h2c://…:443` is a hard error in
          # current Caddy ("conflicting scheme and port"), which crash-looped
          # this proxy from its first deploy.
          @api path /api /api/*
          handle @api {
            reverse_proxy ${APP_NAME_PREFIX:?identita instance}-{{T}}-management:443 {
              transport http {
                versions h2c
              }
            }
          }

          # gRPC is demultiplexed here behind the tenant-specific Host router.
          # A host-less Traefik PathPrefix router would match every tenant on a
          # shared ingress and could send a peer to the wrong control plane.
          @grpcMgmt path /management.ManagementService/*
          handle @grpcMgmt {
            reverse_proxy ${APP_NAME_PREFIX:?identita instance}-{{T}}-management:443 {
              transport http {
                versions h2c
              }
            }
          }
          @grpcSignal path /signalexchange.SignalExchange/*
          handle @grpcSignal {
            reverse_proxy h2c://${APP_NAME_PREFIX:?identita instance}-{{T}}-signal:10000
          }

          # Relay WebSocket (rels://<host>:443/relay).
          @relay path /relay /relay/*
          handle @relay {
            reverse_proxy ${APP_NAME_PREFIX:?identita instance}-{{T}}-relay:33080
          }

          # Everything else: dashboard SPA.
          handle {
            reverse_proxy ${APP_NAME_PREFIX:?identita instance}-{{T}}-dashboard:80
          }
        }
        CADDY
        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:80/__netbird_health"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks:
      internal:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}--management
      coolify:
        aliases:
          - ${APP_NAME_PREFIX:?identita instance}-{{T}}--management
    labels:
      - "coolify.managed=true"
      - "traefik.docker.network=coolify"
{{#vnitrni_tls}}
  {{T}}-internal-tls:
    image: ${REGISTRY_PROXY}library/caddy:2.8-alpine
    container_name: ${APP_NAME_PREFIX:?identita instance — jméno na sdíleném hostiteli ji MUSÍ nést}-{{T}}--internal-tls
    restart: unless-stopped
    init: true
    depends_on:
      pki-init:
        condition: service_completed_successfully
      {{T}}-management:
        condition: service_started
      {{T}}-signal:
        condition: service_started
      {{T}}-relay:
        condition: service_started
    environment:
      GATEWAY_TRUSTED_PROXIES: ${GATEWAY_TRUSTED_PROXIES:-}
      NETBIRD_INTERNAL_CERT_B64: ${{{E}}_INTERNAL_CERT_B64:-}
      NETBIRD_INTERNAL_KEY_B64: ${{{E}}_INTERNAL_KEY_B64:-}
      NETBIRD_MESH_HOST: ${{{E}}_MESH_HOST}
    ports:
      - "${{{E}}_MESH_PORT:-33073}:33073"
    volumes:
      - pki-certs:/ca:ro
      - {{T}}-internal-tls-data:/data
    command:
      - sh
      - -c
      - |
        set -eu
        mkdir -p /etc/caddy/certs
        # Fail-loud sentinel: cleared at every start, re-set by the self-signed
        # bootstrap branch below. The healthcheck reads it so a self-signed
        # fallback reports UNHEALTHY instead of the old no-op `|| exit 0` that
        # showed green on a fully broken mesh TLS terminator (O5).
        rm -f /data/.tls-selfsigned-fallback 2>/dev/null || true
        cd /etc/caddy/certs
        # The Caddyfile below is rendered with these two knobs. Default =
        # explicit AISHA PKI cert (acquisition paths 1 & 2 below). The bootstrap
        # fallback (path 3) flips them to Caddy's built-in internal CA — the
        # caddy:2.8-alpine image ships NO openssl, so we never shell out to it.
        GLOBAL_AUTO_HTTPS="auto_https off"
        TLS_DIRECTIVE="tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem"
        # Cert acquisition priority (most preferred first):
        #   1. NETBIRD_INTERNAL_CERT_B64 / KEY_B64 env — issued + distributed by
        #      aisha-pki-renewer (the SINGLE owner of the *.mesh cert lifecycle;
        #      see infra/pki/pki-renewer.sh). Expiry-managed + refreshed centrally.
        #      This wins over the volume so a stale/absent volume cert from the
        #      in-container pki-init never shadows the renewer's fresh cert.
        #   2. /ca/netbird-mesh/{cert,key}.pem volume — FALLBACK only: the local
        #      pki-init (issue-netbird-mesh-cert.sh) or a legacy manual drop.
        #   3. self-signed bootstrap — last resort, agents will fail TLS verify.
        if [ -n "$${NETBIRD_INTERNAL_CERT_B64}" ] && [ -n "$${NETBIRD_INTERNAL_KEY_B64}" ]; then
          echo "[caddy-internal-tls] Loading AISHA PKI cert from env (NETBIRD_INTERNAL_CERT_B64) — issued+distributed by aisha-pki-renewer (single owner)"
          echo "$${NETBIRD_INTERNAL_CERT_B64}" | base64 -d > cert.pem
          echo "$${NETBIRD_INTERNAL_KEY_B64}" | base64 -d > key.pem
          chmod 600 key.pem
        elif [ -f /ca/netbird-mesh/cert.pem ] && [ -f /ca/netbird-mesh/key.pem ]; then
          echo "[caddy-internal-tls] Loading AISHA PKI cert from /ca/netbird-mesh/ volume (fallback — local pki-init/legacy)"
          cp /ca/netbird-mesh/cert.pem cert.pem
          cp /ca/netbird-mesh/key.pem  key.pem
          chmod 600 key.pem
        else
          echo "[caddy-internal-tls] !!! WARN: no AISHA cert at /ca/netbird-mesh/ AND no NETBIRD_INTERNAL_CERT_B64 in env"
          echo "[caddy-internal-tls] !!! Falling back to Caddy 'tls internal' (locally-trusted CA). Agents will FAIL TLS verify until the AISHA PKI cert is issued."
          echo "[caddy-internal-tls] !!! Self-heal path: ensure pki-init container has PKI_BOOTSTRAP_* creds + pki-bridge reachable."
          # Re-print pki-init's last diagnostic (written to shared volume by
          # issue-netbird-mesh-cert.sh). pki-init is an init container — its
          # stdout is NOT captured by Coolify v4 app-logs when any sibling is
          # restarting. internal-tls IS long-lived so this side-channel makes
          # the 401-diagnostic discoverable in our (running) logs.
          if [ -f /ca/last-issue-attempt.log ]; then
            echo "[caddy-internal-tls] ─── pki-init diagnostic (side-channel) ───"
            cat /ca/last-issue-attempt.log | sed 's/^/[caddy-internal-tls]   /'
            echo "[caddy-internal-tls] ─── end pki-init diagnostic ───"
          fi
          # caddy:2.8-alpine ships NO openssl binary, so we cannot mint a
          # bootstrap cert with `openssl req` (the old code did — it failed
          # "openssl: not found", left cert.pem absent, and Caddy crashlooped).
          # Use Caddy's built-in internal CA instead: `tls internal` issues a
          # locally-trusted self-signed cert so Caddy STARTS and the container
          # stays up (logs discoverable) rather than dying on a missing binary.
          # auto_https must NOT be "off" for internal issuance to run, so the
          # bootstrap path uses "disable_redirects" (keeps cert provisioning,
          # drops the pointless HTTP→HTTPS redirect on this single TLS port).
          GLOBAL_AUTO_HTTPS="auto_https disable_redirects"
          TLS_DIRECTIVE="tls internal"
          # Mesh TLS is DEGRADED (self-signed; agents will fail verify). Set the
          # sentinel so the healthcheck fails loud and Coolify surfaces it — the
          # renewer's NETBIRD_INTERNAL_CERT_B64 refresh is what clears it.
          : > /data/.tls-selfsigned-fallback
        fi
        # UNQUOTED heredoc — $${VAR} has to expand here, so the shell ALSO performs
        # command substitution on every backtick INSIDE, comments included (a '#'
        # line is literal Caddyfile text here, not a shell comment). Keep comments
        # backtick-free: they were executed on every deploy, logging
        # "sh: h2c://host:443: not found" over the real output. Measured 2026-08-08.
        # ⛔ NAMĚŘENO 2026-09-01: Caddy bez `trusted_proxies` příchozímu
        # `x-forwarded-for` NEDŮVĚŘUJE a přepíše ho adresou souseda. HAProxy na
        # pfSense hlavičku nastavuje autoritativně (`del-header` + `set-header
        # X-Forwarded-For %[src]`), takže klientská adresa k nám dorazí — a náš
        # skok ji zahodil. Seznam je TÝŽ, jaký dostává gateway; nedoručený se
        # hlásí NAHLAS a Caddyfile se staví bez něj (prázdný `static` by Caddy
        # neustartoval).
        # ⛔ JEDEN globální blok — týž důvod i tatáž vada jako u netbird-proxy výš
        # (naměřeno 2026-09-02): druhý `{` shodí Caddy, a stane se to právě
        # tehdy, když je `GATEWAY_TRUSTED_PROXIES` doručený.
        {
          printf '{\n  admin off\n'
          [ -n "$${GLOBAL_AUTO_HTTPS:-}" ] && printf '  %s\n' "$${GLOBAL_AUTO_HTTPS}"
          if [ -n "$${GATEWAY_TRUSTED_PROXIES:-}" ]; then
            printf '  servers {\n    trusted_proxies static %s\n  }\n' "$$(echo "$${GATEWAY_TRUSTED_PROXIES}" | tr ',' ' ')"
          else
            echo "[caddy] GATEWAY_TRUSTED_PROXIES NEDORUČEN — x-forwarded-for bude PŘEPSÁN" >&2
          fi
          printf '  log default {\n    output stdout\n    level INFO\n  }\n}\n\n'
        } > /etc/caddy/Caddyfile
        cat >> /etc/caddy/Caddyfile <<CADDY

        # Single TLS endpoint on :33073 — routes to mgmt/signal/relay by path.
        # All paths get same AISHA PKI cert. Agents trust via aisha-ca-bundle.
        :33073 {
          $${TLS_DIRECTIVE}

          # NetBird management gRPC + REST API
          @mgmt {
            # Holé /api patří do matcheru stejně jako v netbird-proxy výš
            # ('@api path /api /api/*'): Caddy '/api/*' vyžaduje aspoň
            # '/api/', takže vlastní healthcheck téhle služby — wget na
            # https://127.0.0.1:33073/api — padal do 'handle { respond 404 }'
            # a sonda NEMOHLA projít nikdy. Terminátor přitom TLS obsluhoval
            # správně (handshake na netbird.mesh.<tld>, h2, agenti připojeni);
            # trvale červená sonda jen přebíjela skutečné poruchy.
            path /api /api/* /management.ManagementService/*
          }
          handle @mgmt {
            # Caddy v2.7+ rejects 'h2c://host:443' because port 443 is the
            # well-known HTTPS port and the h2c scheme implies plaintext —
            # the parser flags this as scheme/port conflict and aborts adapt.
            # Canonical idiom: bare upstream + transport block to declare
            # plaintext h2c. Equivalent semantics, passes the new check.
            reverse_proxy ${APP_NAME_PREFIX:?identita instance}-{{T}}-management:443 {
              transport http {
                versions h2c
              }
            }
          }

          # Signal exchange (peer coordination)
          @signal {
            path /signalexchange.SignalExchange/*
          }
          handle @signal {
            # Same canonical h2c idiom as @mgmt above. Port :10000 doesn't
            # trip the scheme/port conflict check today (no well-known TLS
            # association), but keeping the shape consistent guards against
            # future Caddy versions tightening the rule further.
            reverse_proxy ${APP_NAME_PREFIX:?identita instance}-{{T}}-signal:10000 {
              transport http {
                versions h2c
              }
            }
          }

          # Relay (WebSocket fallback for NAT-traversal)
          @relay {
            path /relay /relay/*
          }
          handle @relay {
            reverse_proxy http://${APP_NAME_PREFIX:?identita instance}-{{T}}-relay:33080
          }

          # Default: 404 (no other paths exposed)
          handle {
            respond "NetBird internal mesh endpoint — invalid path" 404
          }
        }
        CADDY
        # Hláška MUSÍ odpovídat tomu, co se opravdu naservíruje. Do 2026-08-14
        # tu stálo natvrdo „with AISHA PKI cert" — i na řádku hned po přiznání,
        # že žádný cert není a jede se na self-signed. Operátor pak v logu čte
        # opak toho, co se stalo.
        if [ -f /data/.tls-selfsigned-fallback ]; then
          echo "[caddy-internal-tls] starting caddy on :33073 se SELF-SIGNED certifikátem (AISHA PKI cert chybí) — agenti neprojdou TLS verify"
        else
          echo "[caddy-internal-tls] starting caddy on :33073 s AISHA PKI certifikátem"
        fi
        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
    healthcheck:
      test: ["CMD-SHELL", "if [ -f /data/.tls-selfsigned-fallback ]; then echo 'DEGRADOVÁNO: běží self-signed cert, PKI cert pro mesh se nevydal — agenti selžou na TLS verify (viz pki-init diagnostiku výše v logu)'; exit 1; fi; wget -S -q -O /dev/null --no-check-certificate https://127.0.0.1:33073/api/users 2>&1 | grep -qE 'HTTP/1\\.[01] (200|401|403)' || { echo 'upstream neodpověděl 200/401/403 na /api/users — TLS terminovalo, ale routa nebo netbird-management neodpovídá'; exit 1; }"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks:
      - internal

{{/vnitrni_tls}}
volumes:
  {{T}}-mgmt-v5:
    driver: local
  {{T}}-signal-v5:
    driver: local
  {{T}}-config-v5:
    driver: local
  {{T}}-db-data-v5:
    driver: local
{{#vnitrni_tls}}
  {{T}}-internal-tls-data:
    driver: local
  pki-certs:
    driver: local
    name: ${APP_NAME_PREFIX:?}_{{T}}-pki-certs
{{/vnitrni_tls}}
networks:
  internal:
    external: true
    name: ${APP_NAME_PREFIX:?identita instance}-shared-net
  coolify:
    external: true
    name: coolify
