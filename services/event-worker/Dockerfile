# syntax=docker/dockerfile:1
# event-worker — PG LISTEN → Redis event fan-out worker
#
# Registry-free workspace build. Build CONTEXT = REPO ROOT.
# @aisha/* are monorepo WORKSPACE packages (packages/*), resolved via npm
# workspace symlinks and built from source — NO Verdaccio, NO VERDACCIO_TOKEN,
# NO .npmrc. Internal code never round-trips a registry, so cold-start rebuilds
# are deterministic and no npm auth token ever enters the build.
ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
# Whole repo so npm resolves the full workspace graph + symlinks @aisha/*.
COPY . .
RUN npm ci --workspace=@aisha/event-worker --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/acs-contracts && \
    npm run build --workspace=@aisha/acs-sdk && \
    npm run build --workspace=@aisha/event-worker
# Prod-only deps via a CLEAN reinstall (NOT `npm prune` — the workspace prune has
# evicted hoisted prod deps on deep trees). packages/*/dist built above survive
# the node_modules wipe; `npm ci` recreates the @aisha/* workspace symlinks.
RUN rm -rf node_modules services/event-worker/node_modules \
 && npm ci --workspace=@aisha/event-worker --omit=dev --ignore-scripts
# Guarantee the service's own node_modules dir exists so the runtime COPY never fails.
RUN mkdir -p services/event-worker/node_modules
# Fail LOUD: every declared prod dep must resolve in the image, or the BUILD breaks
# here instead of crash-looping in prod. Generic guard, no hardcoded names.
RUN node scripts/verify-runtime-deps.mjs services/event-worker

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Root-hoisted node_modules + workspace package dirs required by the symlinked
# @aisha/* dependencies (their targets must travel, else ERR_MODULE_NOT_FOUND).
# `su-exec` shazuje práva po postavení mesh routy: entrypoint (v compose) musí
# začít jako root, protože `ip route` vyžaduje NET_ADMIN, který neprivilegovaný
# uživatel nedostane. Táž dvojice jako u Dockerfile.web-render.
RUN apk add --no-cache su-exec

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
# ACS workspace deps (IP-4 inbound gate): symlink targets must travel.
COPY --from=build /app/packages/acs-contracts packages/acs-contracts
COPY --from=build /app/packages/acs-sdk packages/acs-sdk
COPY --from=build /app/services/event-worker/package.json services/event-worker/package.json
COPY --from=build /app/services/event-worker/dist services/event-worker/dist
# Nested (non-hoisted) service deps must travel too.
COPY --from=build /app/services/event-worker/node_modules services/event-worker/node_modules
WORKDIR /app/services/event-worker
# ⛔ ŽÁDNÉ `USER node` V OBRAZU (naměřeno 2026-09-06). Entrypoint musí začít
# jako root, aby postavil routu do mesh, a teprve pak práva zahodí přes
# `exec su-exec node …` (viz docker-compose.coolify-realtime.yml). Služba tedy
# běží neprivilegovaně stejně jako dřív — jen se to rozhoduje o krok později.
# Bez toho `ip route` selže na Permission denied, mesh jméno se přeloží na
# adresu, na kterou se nelze spojit, a služba visí na timeoutu místo aby
# selhala hned. Práva NESMÍ zůstat rootovská: brána `mesh-lane-miri-jmenem-ne-hopem`
# hlídá, že entrypoint končí přes su-exec.
CMD ["node", "dist/worker.js"]
