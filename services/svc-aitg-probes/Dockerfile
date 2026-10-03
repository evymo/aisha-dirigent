# syntax=docker/dockerfile:1
# svc-aitg-probes — OWASP AI Testing Guide runtime probe service (port 3041)
#
# Registry-free workspace build. Build CONTEXT = REPO ROOT.
# @aisha/* are monorepo WORKSPACE packages (packages/*), resolved via npm
# workspace symlinks and built from source — NO Verdaccio, NO VERDACCIO_TOKEN,
# NO .npmrc. Internal code never round-trips a registry, so cold-start rebuilds
# are deterministic and no npm auth token ever enters the build.
#
# Dependency chain: @aisha/observability (OTel bootstrap + metrics plugin,
# required of every deployed service by wp-0-1-otel-bootstrap) → @aisha/security
# (self-contained, its own logger.ts) → @aisha/aitg (security + zod) → this
# service. Build order below follows it.
ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
# Whole repo so npm resolves the full workspace graph + symlinks @aisha/*.
COPY . .
RUN npm ci --workspace=@aisha/svc-aitg-probes --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/aitg && \
    npm run build --workspace=@aisha/svc-aitg-probes
# Prod-only deps via a CLEAN reinstall (NOT `npm prune` — the workspace prune has
# evicted hoisted prod deps on deep trees). packages/*/dist built above survive
# the node_modules wipe; `npm ci` recreates the @aisha/* workspace symlinks.
RUN rm -rf node_modules services/svc-aitg-probes/node_modules \
 && npm ci --workspace=@aisha/svc-aitg-probes --omit=dev --ignore-scripts
# Guarantee the service's own node_modules dir exists so the runtime COPY never fails.
RUN mkdir -p services/svc-aitg-probes/node_modules
# Fail LOUD: every declared prod dep must resolve in the image, or the BUILD breaks
# here instead of crash-looping in prod. Generic guard, no hardcoded names.
RUN node scripts/verify-runtime-deps.mjs services/svc-aitg-probes

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Root-hoisted node_modules + workspace package dirs required by the symlinked
# @aisha/* dependencies (their targets must travel, else ERR_MODULE_NOT_FOUND).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# Whole dirs so nested, non-hoisted node_modules travel too — @aisha/
# observability's @opentelemetry/* are the known case.
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/packages/aitg packages/aitg
COPY --from=build /app/services/svc-aitg-probes/package.json services/svc-aitg-probes/package.json
COPY --from=build /app/services/svc-aitg-probes/dist services/svc-aitg-probes/dist
# Nested (non-hoisted) service deps must travel too.
COPY --from=build /app/services/svc-aitg-probes/node_modules services/svc-aitg-probes/node_modules
WORKDIR /app/services/svc-aitg-probes
EXPOSE 3041
# Mesh routu staví entrypoint v compose JAKO ROOT a práva hned zahodí přes
# `exec su-exec node …` (vzor: gateway, brána mesh-lane-miri-jmenem-ne-hopem).
# ⛔ NAMĚŘENO 2026-09-16 na guru: s `USER node` v obrazu služba routu postavit
# nemohla, mesh jméno se přeložilo a NESPOJILO — svc-ai-chat vypršel na PostgREST,
# MCP, lokálním modelu, companion i integration, a nic to nehlásilo jako chybu.
RUN apk add --no-cache su-exec iproute2
CMD ["node", "dist/server.js"]
