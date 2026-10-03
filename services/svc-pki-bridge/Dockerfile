# syntax=docker/dockerfile:1
# svc-pki-bridge — svc-pki-bridge — autonomous cert issuance via JWT + OpenXPKI RPC
#
# Registry-free workspace build. Build CONTEXT = REPO ROOT.
# @aisha/* are monorepo WORKSPACE packages (packages/*), resolved via npm
# workspace symlinks and built from source — NO Verdaccio, NO VERDACCIO_TOKEN,
# NO .npmrc. Internal code never round-trips a registry, so cold-start rebuilds
# are deterministic and no npm auth token ever enters the build.
ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
# Whole repo so npm resolves the full workspace graph + symlinks @aisha/*.
COPY . .
RUN npm ci --workspace=@aisha/svc-pki-bridge --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/svc-pki-bridge
# Prod-only deps via a CLEAN reinstall (NOT `npm prune` — the workspace prune has
# evicted hoisted prod deps on deep trees). packages/*/dist built above survive
# the node_modules wipe; `npm ci` recreates the @aisha/* workspace symlinks.
RUN rm -rf node_modules services/svc-pki-bridge/node_modules \
 && npm ci --workspace=@aisha/svc-pki-bridge --omit=dev --ignore-scripts
# Guarantee the service's own node_modules dir exists so the runtime COPY never fails.
RUN mkdir -p services/svc-pki-bridge/node_modules
# Fail LOUD: every declared prod dep must resolve in the image, or the BUILD breaks
# here instead of crash-looping in prod. Generic guard, no hardcoded names.
RUN node scripts/verify-runtime-deps.mjs services/svc-pki-bridge

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl wget
# Root-hoisted node_modules + workspace package dirs required by the symlinked
# @aisha/* dependencies (their targets must travel, else ERR_MODULE_NOT_FOUND).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/services/svc-pki-bridge/package.json services/svc-pki-bridge/package.json
COPY --from=build /app/services/svc-pki-bridge/dist services/svc-pki-bridge/dist
# Nested (non-hoisted) service deps must travel too.
COPY --from=build /app/services/svc-pki-bridge/node_modules services/svc-pki-bridge/node_modules
WORKDIR /app/services/svc-pki-bridge
EXPOSE 3040
USER node
CMD ["node", "dist/server.js"]
