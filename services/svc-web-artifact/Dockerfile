# syntax=docker/dockerfile:1
# svc-web-artifact — story-driven web design pipeline microservice (port 3030)
#
# Workspace-aware, registry-free build. Build CONTEXT = REPO ROOT
# (docker-compose.coolify.yml). @aisha/security + @aisha/observability are
# monorepo WORKSPACE packages (packages/*), resolved via npm workspace symlinks
# — `npm ci --workspace=@aisha/svc-web-artifact --include-workspace-root`. No
# Verdaccio (private Verdaccio, $VERDACCIO_URL), no VERDACCIO_TOKEN, no .npmrc: the internal packages
# are never published to a registry, so the old `.npmrc` + `npm install` form
# failed `npm notarget`/E404 whenever the build cache was busted — a cold-start
# reproducibility hole. Workspaces build internal code from source, every time.

ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
# Whole repo so npm resolves the full workspace graph + symlinks @aisha/*.
COPY . .

# ── Branded design overlay (build-time, OSS-boundary-safe) ───────────────────
# When the operator supplies a private design repo (Coolify build-time envs
# AISHA_WEB_DESIGN_GIT_URL + AISHA_SEED_DOMAIN + FORGEJO_TOKEN), clone it into
# domains/templates/<AISHA_SEED_DOMAIN>/ so the runtime /seed-default ingests it
# into web_pages. Public/OSS builds leave these unset → the committed placeholder
# stays and domains/default/ is the homepage.
#
# FORGEJO_TOKEN arrives as a BuildKit secret, NOT as a build ARG.
#
# This comment used to claim the token was safe because it is consumed only in
# THIS build stage and the runtime stage never declares the ARG. Under a plain
# `docker build` that reasoning holds. Under Coolify it does NOT:
# `modify_dockerfiles_for_compose()` injects `ARG <KEY>` after EVERY `FROM`,
# including the runtime one, which re-introduces the declaration and lets the
# value be recorded. Measured 2026-08-15 on this very image — FORGEJO_TOKEN was
# present in `docker history` of the FINAL image, exactly where the old comment
# said it could not be. A defence built on the shape of the Dockerfile does not
# survive something that rewrites that shape at deploy time.
#
# `--mount=type=secret` cannot be undone that way: the value lives in a tmpfs
# for the duration of one instruction and is written to no layer and no history.
# Measured: via build ARG 2 occurrences of the value in image metadata, via
# secret 0.
#
# Requirement: the variable must NOT be flagged build-time in Coolify, otherwise
# Coolify additionally passes it as `--build-arg` and the leak returns. Compose
# hands it over through `secrets:` (see docker-compose.coolify.yml), which reads
# the deployment `.env` and needs no build-time flag.
# The design itself is NEVER committed to this repo
# (public-oss-boundary gate); it's fetched transiently here (.git stripped) and
# only its files reach the runtime image. URL comes from an ARG (no hardcoded
# forge host → no-hardcoded-deployment-config gate).
ARG AISHA_WEB_DESIGN_GIT_URL=
ARG AISHA_SEED_DOMAIN=
# Podadresář designového repa, který JE tou šablonou. Prázdný = kořen repa,
# tedy chování, jaké tu bylo doteď (AISHA má web v samostatném repu).
#
# ⭐ PROČ VZNIKL: instance smí mít JEDNO designové repo pro grafiku, šablony
# i obsah webu. Klon dává kořen repa na `domains/templates/<domain>/`, takže
# bez tohohle parametru by se do runtime obrazu vezly i zdrojáky jazyka
# (`rdl/`) a náhledy komponent — zdroj uvnitř běhového obrazu.
# S ním má repo čistý tvar: `web/` je šablona, `rdl/` jazyk, `brand/` mobil.
ARG AISHA_WEB_DESIGN_SUBDIR=
# ⛔ CACHEBUST — without it the design ships ONCE and never again.
# BuildKit keys the layer on the command TEXT, which does not change between
# deploys: `git clone` never re-runs and the image keeps the design repo's
# content from the day of the first build. Measured 2026-08-02 on the sibling
# clone in Dockerfile.keycloak — the rewritten theme never reached the image and
# the build reported success. Same class as the 2026-06-30 incident this stage
# already documents, except the silent WARN is now a silent CACHE.
# Deployment MUST pass a value that changes (design repo commit SHA or a
# timestamp). Empty while the overlay is on aborts the build — loud > silent.
# Enforced by the `overlay-clone-cachebust` gate.
ARG AISHA_WEB_DESIGN_CACHEBUST=
# FAIL-LOUD when the operator INTENDS a branded site (AISHA_WEB_DESIGN_GIT_URL
# set): a misconfig (missing SEED_DOMAIN/TOKEN) or a clone failure must abort the
# build, NOT silently ship the placeholder (2026-06-30: the design never
# propagated and the silent WARN hid it). URL empty = community install → skip.
RUN --mount=type=secret,id=forgejo_token,required=false \
    FORGEJO_TOKEN="$(cat /run/secrets/forgejo_token 2>/dev/null || true)"; \
    if [ -n "$AISHA_WEB_DESIGN_GIT_URL" ]; then \
      if [ -z "$AISHA_SEED_DOMAIN" ] || [ -z "$FORGEJO_TOKEN" ]; then \
        echo "[design-overlay] FATAL: AISHA_WEB_DESIGN_GIT_URL set but AISHA_SEED_DOMAIN/FORGEJO_TOKEN empty — cannot ingest the branded design" >&2; exit 1; \
      fi; \
      if [ -z "$AISHA_WEB_DESIGN_CACHEBUST" ]; then \
        echo "[design-overlay] FATAL: AISHA_WEB_DESIGN_GIT_URL set but AISHA_WEB_DESIGN_CACHEBUST empty — BuildKit would reuse the cached clone and ship the design from the FIRST build, silently. Pass the design repo commit SHA or a timestamp." >&2; exit 1; \
      fi; \
      # ⛔ Pověření NESMÍ přijít v URL. Build arg se zapisuje do `docker history`
      # KONEČNÉHO obrazu — naměřeno 2026-08-15 právě na tomhle svc-web-artifactu,
      # a znovu 2026-09-21 na povrchu, kde týž tvar vyrobil token ve čtyřech
      # obrazech. Obrana postavená na tvaru Dockerfilu neobstojí: Coolify vkládá
      # `ARG <KEY>` za KAŽDÝ `FROM`, takže i běhový stage hodnotu znovu deklaruje.
      # Token patří výhradně do BuildKit secretu forgejo_token, který se níž
      # vkládá do adresy klonu. Sesterské stráže: deploy/surface-host/Dockerfile,
      # Dockerfile.svc-source-broker, Dockerfile.keycloak.
      AUTORITA="${AISHA_WEB_DESIGN_GIT_URL#https://}"; AUTORITA="${AUTORITA%%/*}"; \
      case "$AUTORITA" in *@*) \
        echo "[design-overlay] FATAL: AISHA_WEB_DESIGN_GIT_URL nese pověření v URL (URL se nevypisuje)." >&2; \
        echo "                 Build arg se zapisuje do docker history — token patří do BuildKit secretu forgejo_token." >&2; \
        exit 1 ;; \
      esac; \
      apk add --no-cache git >/dev/null 2>&1 || true; \
      DEST="domains/templates/${AISHA_SEED_DOMAIN}"; TMP=/tmp/_design; \
      if git clone --depth 1 "https://${FORGEJO_TOKEN}@${AISHA_WEB_DESIGN_GIT_URL#https://}" "$TMP"; then \
        rm -rf "$TMP/.git"; \
        if [ -n "$AISHA_WEB_DESIGN_SUBDIR" ]; then \
          if [ ! -d "$TMP/$AISHA_WEB_DESIGN_SUBDIR" ]; then \
            echo "[design-overlay] FATAL: AISHA_WEB_DESIGN_SUBDIR='$AISHA_WEB_DESIGN_SUBDIR' v designovém repu NENÍ — šablona by byla prázdná a web by se nasadil bez obsahu. Oprav podadresář, nebo ho nech prázdný (= kořen repa)." >&2; exit 1; \
          fi; \
          mv "$TMP/$AISHA_WEB_DESIGN_SUBDIR" /tmp/_web; rm -rf "$TMP"; mv /tmp/_web "$TMP"; \
          echo "[design-overlay] šablona vzata z podadresáře '$AISHA_WEB_DESIGN_SUBDIR' (zbytek repa do obrazu nejde)"; \
        fi; \
        rm -rf "$DEST"; mkdir -p "$(dirname "$DEST")"; mv "$TMP" "$DEST"; \
        echo "[design-overlay] seeded $DEST from operator design repo (cachebust=${AISHA_WEB_DESIGN_CACHEBUST})"; \
        find "$DEST" -type f | sort | xargs cat 2>/dev/null | md5sum \
          | sed 's/^/[design-overlay] content fingerprint: /'; \
      else \
        echo "[design-overlay] FATAL: design clone failed for the operator design repo — refusing to ship the placeholder when a branded design was requested" >&2; exit 1; \
      fi; \
    else \
      echo "[design-overlay] skipped (AISHA_WEB_DESIGN_GIT_URL unset) — committed placeholder + domains/default"; \
    fi

RUN npm ci --workspace=@aisha/svc-web-artifact --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/web-canvas && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/svc-web-artifact
# Prod-only deps via a CLEAN reinstall — NOT `npm prune --workspace --omit=dev`.
# The workspace-scoped prune wrongly EVICTS hoisted PRODUCTION deps: jsdom
# (dependencies: ^25.0.1, used by lib/htmlToProjectData on the /parse and
# /seed-default runtime routes) vanished from the image while its transitive deps
# survived → prod ERR_MODULE_NOT_FOUND crashloop (~18k restarts). `npm ci
# --omit=dev` installs exactly the prod closure from the lockfile, deterministically.
# packages/*/dist built above survive the node_modules wipe (they live under
# packages/, not node_modules); npm ci recreates the @aisha/* workspace symlinks.
RUN rm -rf node_modules services/svc-web-artifact/node_modules \
 && npm ci --workspace=@aisha/svc-web-artifact --omit=dev --ignore-scripts
# Guarantee the service's own node_modules dir exists so the runtime COPY below
# never fails — and carries any dep npm nested HERE instead of hoisting to root.
RUN mkdir -p services/svc-web-artifact/node_modules
# Fail LOUD: every prod dependency the service DECLARES must resolve in the image,
# or the BUILD breaks here instead of crash-looping in prod. Generic guard, no
# hardcoded package names — the service's declared deps are the spec.
RUN node scripts/verify-runtime-deps.mjs services/svc-web-artifact

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# node_modules + dep-chain workspace dirs (whole dirs so nested, non-hoisted
# node_modules — e.g. @aisha/observability's @opentelemetry/* — travel along).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/packages/observability packages/observability
# ⛔ NAMĚŘENO 2026-08-31: bez tohohle řádku spadl CELÝ core stack. Služba
# importuje `@aisha/web-canvas` (htmlToProjectData), balíček se ve stavěcím
# stupni postaví, ale do běhového se nekopíroval — symlink v node_modules pak
# mířil do prázdna a kontejner se zacyklil na ERR_MODULE_NOT_FOUND. Coolify to
# po několika restartech vyhodnotil jako `RestartLimitReached` a zastavil celou
# aplikaci (`StopApplication` = compose down), takže výpadek nevypadal jako
# vada jedné služby, ale jako mizející stack. Přesně ten scénář, před kterým
# varuje komentář o ~18k restartech o pár řádků výš.
COPY --from=build /app/packages/web-canvas packages/web-canvas
COPY --from=build /app/services/svc-web-artifact/package.json services/svc-web-artifact/package.json
COPY --from=build /app/services/svc-web-artifact/dist services/svc-web-artifact/dist
# Web design templates (DOMAINS_DIR=/app/domains). The runtime image MUST carry
# domains/ so /seed-default can ingest domains/templates/<AISHA_SEED_DOMAIN>/
# (operator design overlaid in the build stage) or domains/default/ into
# web_pages. Previously absent → /app/domains was empty → /seed-default found no
# template → web_pages stayed EMPTY (the prod "no design / blank site" symptom).
COPY --from=build /app/domains ./domains
# Nested (non-hoisted) deps live under the service's own node_modules — copy
# them too, else Node can't resolve them at runtime (ERR_MODULE_NOT_FOUND).
COPY --from=build /app/services/svc-web-artifact/node_modules services/svc-web-artifact/node_modules
WORKDIR /app/services/svc-web-artifact
EXPOSE 3030
USER node
CMD ["node", "dist/server.js"]
