# syntax=docker/dockerfile:1
# ws-gateway — Redis → WebSocket gateway service
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
RUN npm ci --workspace=@aisha/ws-gateway --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/ws-gateway
# Prod-only deps via a CLEAN reinstall (NOT `npm prune` — the workspace prune has
# evicted hoisted prod deps on deep trees). packages/*/dist built above survive
# the node_modules wipe; `npm ci` recreates the @aisha/* workspace symlinks.
RUN rm -rf node_modules services/ws-gateway/node_modules \
 && npm ci --workspace=@aisha/ws-gateway --omit=dev --ignore-scripts
# Guarantee the service's own node_modules dir exists so the runtime COPY never fails.
RUN mkdir -p services/ws-gateway/node_modules
# Fail LOUD: every declared prod dep must resolve in the image, or the BUILD breaks
# here instead of crash-looping in prod. Generic guard, no hardcoded names.
RUN node scripts/verify-runtime-deps.mjs services/ws-gateway

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
COPY --from=build /app/services/ws-gateway/package.json services/ws-gateway/package.json
COPY --from=build /app/services/ws-gateway/dist services/ws-gateway/dist
# Nested (non-hoisted) service deps must travel too.
COPY --from=build /app/services/ws-gateway/node_modules services/ws-gateway/node_modules
WORKDIR /app/services/ws-gateway
EXPOSE 3002
# ⛔ ŽÁDNÉ `USER node` V OBRAZU (naměřeno 2026-09-06). Entrypoint musí začít
# jako root, aby postavil routu do mesh, a teprve pak práva zahodí přes
# `exec su-exec node …` (viz docker-compose.coolify-realtime.yml). Služba tedy
# běží neprivilegovaně stejně jako dřív — jen se to rozhoduje o krok později.
# Bez toho `ip route` selže na Permission denied, mesh jméno se přeloží na
# adresu, na kterou se nelze spojit, a služba visí na timeoutu místo aby
# selhala hned. Práva NESMÍ zůstat rootovská: brána `mesh-lane-miri-jmenem-ne-hopem`
# hlídá, že entrypoint končí přes su-exec.
CMD ["node", "dist/server.js"]
