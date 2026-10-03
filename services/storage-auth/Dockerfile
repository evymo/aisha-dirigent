# syntax=docker/dockerfile:1
# storage-auth — MinIO/storage auth + presign service
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
RUN npm ci --workspace=@aisha/storage-auth --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/storage-auth
# Prod-only deps via a CLEAN reinstall (NOT `npm prune` — the workspace prune has
# evicted hoisted prod deps on deep trees). packages/*/dist built above survive
# the node_modules wipe; `npm ci` recreates the @aisha/* workspace symlinks.
RUN rm -rf node_modules services/storage-auth/node_modules \
 && npm ci --workspace=@aisha/storage-auth --omit=dev --ignore-scripts
# Guarantee the service's own node_modules dir exists so the runtime COPY never fails.
RUN mkdir -p services/storage-auth/node_modules
# Fail LOUD: every declared prod dep must resolve in the image, or the BUILD breaks
# here instead of crash-looping in prod. Generic guard, no hardcoded names.
RUN node scripts/verify-runtime-deps.mjs services/storage-auth

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Root-hoisted node_modules + workspace package dirs required by the symlinked
# @aisha/* dependencies (their targets must travel, else ERR_MODULE_NOT_FOUND).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/services/storage-auth/package.json services/storage-auth/package.json
COPY --from=build /app/services/storage-auth/dist services/storage-auth/dist
# Nested (non-hoisted) service deps must travel too.
COPY --from=build /app/services/storage-auth/node_modules services/storage-auth/node_modules
WORKDIR /app/services/storage-auth
EXPOSE 3005
# `su-exec` shazuje práva po postavení mesh routy: entrypoint (v compose) začíná
# jako root, protože `ip route` vyžaduje NET_ADMIN. Táž dvojice jako u gateway.
RUN apk add --no-cache su-exec iproute2
# ⛔ ŽÁDNÉ `USER node` V OBRAZU. `CLAMD_HOST` je mesh jméno antiviru (katalog
# internal_tcp_endpoints): bez routy do rozsahu peerů se PŘELOŽÍ a NESPOJÍ a každý
# upload visí na timeoutu skenu. Entrypoint postaví routu a teprve pak práva
# zahodí přes `exec su-exec node …` (hlídá brána `mesh-lane-miri-jmenem-ne-hopem`).
CMD ["node", "dist/server.js"]
