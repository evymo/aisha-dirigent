# syntax=docker/dockerfile:1
# svc-stripe — Stripe payments integration service
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
RUN npm ci --workspace=@aisha/svc-stripe --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/postgrest-client && \
    npm run build --workspace=@aisha/svc-stripe
# Prod-only deps via a CLEAN reinstall (NOT `npm prune` — the workspace prune has
# evicted hoisted prod deps on deep trees). packages/*/dist built above survive
# the node_modules wipe; `npm ci` recreates the @aisha/* workspace symlinks.
RUN rm -rf node_modules services/svc-stripe/node_modules \
 && npm ci --workspace=@aisha/svc-stripe --omit=dev --ignore-scripts
# Guarantee the service's own node_modules dir exists so the runtime COPY never fails.
RUN mkdir -p services/svc-stripe/node_modules
# Fail LOUD: every declared prod dep must resolve in the image, or the BUILD breaks
# here instead of crash-looping in prod. Generic guard, no hardcoded names.
RUN node scripts/verify-runtime-deps.mjs services/svc-stripe

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Root-hoisted node_modules + workspace package dirs required by the symlinked
# @aisha/* dependencies (their targets must travel, else ERR_MODULE_NOT_FOUND).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/packages/postgrest-client packages/postgrest-client
COPY --from=build /app/services/svc-stripe/package.json services/svc-stripe/package.json
COPY --from=build /app/services/svc-stripe/dist services/svc-stripe/dist
# Nested (non-hoisted) service deps must travel too.
COPY --from=build /app/services/svc-stripe/node_modules services/svc-stripe/node_modules
WORKDIR /app/services/svc-stripe
EXPOSE 3010
# Mesh routu staví entrypoint v compose JAKO ROOT a práva hned zahodí přes
# `exec su-exec node …` (vzor: gateway, brána mesh-lane-miri-jmenem-ne-hopem).
# ⛔ NAMĚŘENO 2026-09-16 na guru: s `USER node` v obrazu služba routu postavit
# nemohla, mesh jméno se přeložilo a NESPOJILO — svc-ai-chat vypršel na PostgREST,
# MCP, lokálním modelu, companion i integration, a nic to nehlásilo jako chybu.
RUN apk add --no-cache su-exec iproute2
CMD ["node", "dist/server.js"]
