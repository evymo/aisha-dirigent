ARG REGISTRY_PROXY=
# ============================================================================
# Generic surface-host — build any surface shell for any instance, serve static.
# ============================================================================
# The extranet/mobile surfaces are single-purpose SPAs composed from the stack's
# ready capabilities (surface_blocks + RPC + KC). This image is the GENERIC host:
# it builds a chosen shell against a chosen instance overlay and serves the static
# bundle with SPA fallback. Instance-specific = build args only.
#
#   docker build -f deploy/surface-host/Dockerfile \
#     --build-arg SHELL_APP=workbench-shell --build-arg INSTANCE_DIR=instances/<slug> .
#
# Auth is NOT baked in: the shell reads its instance app.config.json at build time
# (issuer, postgrest_url, empty token_exchange_url = gateway-mints). No secrets here.
# ============================================================================
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
COPY . .
ARG SHELL_APP=workbench-shell
ARG INSTANCE_DIR=instances/_default

# ── Instanční overlay přichází z INSTANČNÍHO REPA, ne z tohohle stromu ────────
# `app.config.json`, `i18n.json` a `public/` (tokeny značky, ikona, manifest) jsou
# vlastnost JEDNÉ instance. Dokud bydlely tady, byla to nevyhnutelná přetahovaná:
# sync z upstreamu je mazal právem (instanční data do platformy nepatří) a fork je
# vracel právem (bez nich se povrch nepostaví). Naměřeno 2026-08-01: chyběl
# `app.config.json` i `tokens.css` a KAŽDÝ build extranetu deset hodin padal —
# nasazovala se pořád táž stará verze a vypadalo to, že se změny neprojevily.
#
# Bez `SURFACE_OVERLAY_GIT_URL` se nic nemění: staví se proti `instances/_default`
# z tohohle repa, takže upstream i CI jedou dál a generický strom o žádné instanci
# neví. Táž dráha jako `BUNDLE_GIT_URL` u ingestu a `instance-data-hook.sh` u SQL.
#
# Fail-closed: URL zadaná a klon/podadresář chybí = build PADNE. Tiché sesunutí na
# `_default` by vyrobilo povrch s cizí konfigurací a cizím vzhledem — a to je horší
# než spadlý build, protože se to pozná až očima.
#
# ⛔ CACHEBUST — bez něj se overlay NASADÍ JEDNOU A UŽ NIKDY.
# BuildKit kešuje vrstvu podle TEXTU příkazu, a ten se mezi nasazeními nemění:
# `git clone` se pak vůbec nespustí a v obrazu zůstane obsah instančního repa
# ze dne prvního buildu. Naměřeno 2026-08-02 na sesterském klonu v
# Dockerfile.keycloak — přepsané téma se do obrazu nedostalo a build hlásil
# úspěch. Je to táž třída jako „deploy přijat, ale neproveden": zelené, a přesto
# beze změny; a u povrchu se to pozná až očima, protože nic nespadne.
# Nasazení sem MUSÍ poslat hodnotu, která se mění (commit SHA instančního repa
# nebo časové razítko). Prázdná hodnota při zapnutém overlayi build ZASTAVÍ —
# loud > silent. Hlídá brána `overlay-clone-cachebust`.
#
# ⛔ ARGY MUSÍ PŘEDAT COMPOSE VÝSLOVNĚ (naměřeno 2026-09-13, log Coolify nasazení
# extranetu): „Added 30 ARG declarations to Dockerfile for
# service extranet" — a přesto `if [ -n "" ]`, build z `/app/instances/<jméno>`
# a ENOENT. Implicitní vkládání ARG od Coolify hodnotu do `docker compose build`
# nedoneslo; `docker-compose.coolify-extranet.yml` měl v `build.args` jen
# SHELL_APP, INSTANCE_DIR a REGISTRY_PROXY. Hlídá brána overlay-arg-dotece-do-buildu.
#
# ⛔ POVĚŘENÍ NIKDY V URL (naměřeno 2026-09-13): URL instančního repa nesla
# `oauth2:<token>@` — a jako build arg by skončila v `docker history` napořád
# (sesterské měření 2026-08-15 na svc-web-artifact: přes build ARG 2 výskyty
# hodnoty v metadatech, přes BuildKit secret 0). Token proto chodí stejně jako
# u svc-web-artifact a Dockerfile.keycloak: `--mount=type=secret,id=forgejo_token`.
# URL s pověřením build ODMÍTNE — tiché přijetí by únik vrátilo.
ARG SURFACE_OVERLAY_GIT_URL=
# ŽÁDNÝ výchozí overlay path: cesta uvnitř instančního repa je identita
# INSTANCE a vestavěný default by potichu nasadil povrch cizí instance —
# stejná třída jako APP_NAME_PREFIX natvrdo. Kdo zapne overlay, řekne i cestu.
ARG SURFACE_OVERLAY_PATH=
ARG SURFACE_OVERLAY_REF=
ARG SURFACE_OVERLAY_CACHEBUST=
RUN --mount=type=secret,id=forgejo_token,required=false \
    if [ -n "$SURFACE_OVERLAY_GIT_URL" ]; then \
      [ -n "$SURFACE_OVERLAY_CACHEBUST" ] || { \
        echo "CHYBA: SURFACE_OVERLAY_GIT_URL je zadané, ale SURFACE_OVERLAY_CACHEBUST prázdné." >&2; \
        echo "       BuildKit by klon zakešoval a nasadil overlay z PRVNÍHO buildu — tiše." >&2; \
        echo "       Pošli commit SHA instančního repa nebo časové razítko." >&2; exit 1; }; \
      [ -n "$SURFACE_OVERLAY_PATH" ] || { \
        echo "CHYBA: SURFACE_OVERLAY_GIT_URL je zadané, ale SURFACE_OVERLAY_PATH prázdné." >&2; \
        echo "       Cesta k overlayi je identita instance; default neexistuje záměrně." >&2; exit 1; }; \
      case "$SURFACE_OVERLAY_GIT_URL" in https://*) : ;; *) \
        echo "CHYBA: SURFACE_OVERLAY_GIT_URL musí být https:// — token ze secretu se vkládá do https adresy." >&2; exit 1 ;; \
      esac; \
      OVERLAY_AUTORITA="${SURFACE_OVERLAY_GIT_URL#https://}"; OVERLAY_AUTORITA="${OVERLAY_AUTORITA%%/*}"; \
      case "$OVERLAY_AUTORITA" in *@*) \
        echo "CHYBA: SURFACE_OVERLAY_GIT_URL nese pověření v URL (URL se nevypisuje)." >&2; \
        echo "       Build arg se zapisuje do docker history — token patří do BuildKit secretu forgejo_token." >&2; exit 1 ;; \
      esac; \
      FORGEJO_TOKEN="$(cat /run/secrets/forgejo_token 2>/dev/null || true)"; \
      [ -n "$FORGEJO_TOKEN" ] || { \
        echo "CHYBA: SURFACE_OVERLAY_GIT_URL je zadané, ale BuildKit secret forgejo_token je prázdný." >&2; \
        echo "       Instanční repo je privátní; bez tokenu klon selže až u gitu, bez souvislosti s příčinou." >&2; exit 1; }; \
      apk add --no-cache git >/dev/null && \
      git clone --quiet --depth 1 ${SURFACE_OVERLAY_REF:+--branch "$SURFACE_OVERLAY_REF"} \
        "https://${FORGEJO_TOKEN}@${SURFACE_OVERLAY_GIT_URL#https://}" /tmp/overlay && \
      test -f "/tmp/overlay/${SURFACE_OVERLAY_PATH}/app.config.json" || \
        { echo "CHYBA: overlay ${SURFACE_OVERLAY_PATH}/app.config.json v instančním repu není" >&2; exit 1; } && \
      mkdir -p "/app/instances/_overlay" && \
      cp -R "/tmp/overlay/${SURFACE_OVERLAY_PATH}/." "/app/instances/_overlay/" && \
      rm -rf /tmp/overlay && \
      echo "overlay: cachebust=${SURFACE_OVERLAY_CACHEBUST}" && \
      echo "overlay: $(ls /app/instances/_overlay | tr '\n' ' ')" && \
      find /app/instances/_overlay -type f | sort | xargs cat 2>/dev/null | md5sum \
        | sed 's/^/overlay: otisk obsahu: /' ; \
    fi

# Build the shared workspace package first: the shells import @aisha/surface-blocks
# by its published entry (main=dist/index.js, types=dist/index.d.ts), so its dist/
# must exist before the shell's tsc/vite build — otherwise TS2307 "Cannot find
# module '@aisha/surface-blocks'". (Root `build` script builds it first too.)
# ⛔ NAMĚŘENO 2026-08-18: tenhle build závisel na `VERDACCIO_URL`, a nikde to
# nebylo napsané. `.npmrc` v kořeni repa nese `@aisha:registry=${VERDACCIO_URL}`,
# `.dockerignore` ho nevyřazuje a `COPY . .` ho sem doveze. npm ty závorky
# NEROZVINE, když proměnná chybí — nechá tam literál a `npm ci` padne na
#     npm error code ERR_INVALID_URL
# což vypadá jako závada registru, ale je to chybějící konfigurace.
#
# Fungovalo to jen tím, že Coolify si `ARG` pro každou build-time proměnnou
# vkládá SÁM (`modify_dockerfiles_for_compose`). Vazba, kterou v repu nikdo
# nevidí, je přesně to, na čem umřel netbird (`FROM ${NETBIRD_BASE_IMAGE}`
# s prázdnou hodnotou, tři dny ticha). Deklarace to zviditelňuje a hlavně dělá
# build reprodukovatelným MIMO Coolify:
#     docker build --build-arg VERDACCIO_URL=https://npm.example.com/ …
# Prázdná výchozí hodnota není fallback — je to stav „nedodáno", který o řádek
# níž hlasitě padne. Pověření sem NEPATŘÍ: čtení `@aisha/*` je anonymní
# (změřeno) a token by se přes build arg zapsal do `docker history`.
#
# ⚠️ Týchž 31 Dockerfilů v repu má tuhle závislost taky a zatím implicitně —
# viz brána src/tests/gates/npmrc-registr-musi-mit-adresu.gate.test.ts.
ARG VERDACCIO_URL=
RUN npm ci --no-audit --no-fund \
 && npm run build -w packages/surface-blocks \
 && AISHA_INSTANCE_DIR="$([ -f /app/instances/_overlay/app.config.json ] \
        && echo /app/instances/_overlay || echo /app/${INSTANCE_DIR})" \
    npm run build -w "apps/${SHELL_APP}"

FROM ${REGISTRY_PROXY}library/nginx:alpine
ARG SHELL_APP=workbench-shell
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/surface-host/nginx.conf /etc/nginx/conf.d/surface.conf
COPY --from=build /app/apps/${SHELL_APP}/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
