# syntax=docker/dockerfile:1
# svc-mcp-knowledge — RAG knowledge plane microservice (port 3017)
#
# Workspace-aware, registry-free build. Build CONTEXT = REPO ROOT
# (docker-compose.coolify.yml). @aisha/security, @aisha/aitg,
# @aisha/observability, @aisha/cache-redis are monorepo WORKSPACE packages
# (packages/*), resolved via npm workspace symlinks — `npm ci
# --workspace=@aisha/svc-mcp-knowledge --include-workspace-root`. No Verdaccio
# (private Verdaccio, $VERDACCIO_URL), no VERDACCIO_TOKEN, no .npmrc: the internal packages are never
# published to a registry, so the old `.npmrc` + `npm install` form failed
# `npm notarget`/E404 whenever the build cache was busted — a cold-start
# reproducibility hole. Workspaces build internal code from source, every time.

ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
# Whole repo so npm resolves the full workspace graph + symlinks @aisha/*.
COPY . .
# `npm ci` hardened against a flaky/throttled registry (ECONNRESET / "network
# aborted" mid-install, seen under arm64 emulation where the whole workspace
# graph is one long single-shot download):
#   --mount=type=cache  persistent BuildKit npm cache — a retried build resumes
#                       from already-fetched tarballs instead of restarting the
#                       ~9-min install from zero (cacache is content-addressed +
#                       integrity-checked, so nothing stale is trusted).
#   --fetch-retries/…   5 retries with 20s→120s exponential backoff (npm default
#                       is only 2) rides out a transient reset within one run.
#   --fetch-timeout     10-min ceiling for a slow-but-alive connection.
#   --maxsockets=5      caps concurrent connections (npm default 15) to cut the
#                       parallel-socket pressure that trips resets under the
#                       emulated network stack. Cache mount keeps re-runs fast
#                       regardless, so the mild throughput trade is worth it.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@aisha/svc-mcp-knowledge --include-workspace-root --include=dev --ignore-scripts \
      --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 \
      --fetch-timeout=600000 --maxsockets=5
# Build internal deps in dependency order, then the service.
RUN npm run build --workspace=@aisha/accel-protokol && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/cache-redis && \
    npm run build --workspace=@aisha/postgrest-client && \
    npm run build --workspace=@aisha/aitg && \
    npm run build --workspace=@aisha/flowboard-core && \
    npm run build --workspace=@aisha/llm-dispatch && \
    npm run build --workspace=@aisha/svc-mcp-knowledge
RUN npm prune --workspace=@aisha/svc-mcp-knowledge --omit=dev
# Guarantee the service's own node_modules dir exists so the runtime COPY below
# never fails — and carries any dep npm nested HERE instead of hoisting to root.
RUN mkdir -p services/svc-mcp-knowledge/node_modules
# Fail LOUD if the workspace-scoped prune above evicted a declared prod dep (it
# has misfired on deep trees — see svc-web-artifact/jsdom). Generic guard, no
# hardcoded names: build breaks here rather than crash-looping in prod.
RUN node scripts/verify-runtime-deps.mjs services/svc-mcp-knowledge

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# node_modules + dep-chain workspace dirs (whole dirs so nested, non-hoisted
# node_modules — e.g. @aisha/observability's @opentelemetry/* — travel along).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/accel-protokol packages/accel-protokol
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/cache-redis packages/cache-redis
COPY --from=build /app/packages/postgrest-client packages/postgrest-client
COPY --from=build /app/packages/aitg packages/aitg
# flowboard-core is a workspace dep (built above); its package dir must travel
# too, else node_modules/@aisha/flowboard-core's symlink target is absent at
# runtime → ERR_MODULE_NOT_FOUND (only `zod`, root-hoisted, so no nested deps).
COPY --from=build /app/packages/flowboard-core packages/flowboard-core
# llm-dispatch: workspace dep (native Gemini/Anthropic backends used by the RAG
# completion path). Its package dir must travel too, else the @aisha/llm-dispatch
# symlink target is absent at runtime → ERR_MODULE_NOT_FOUND.
COPY --from=build /app/packages/llm-dispatch packages/llm-dispatch
COPY --from=build /app/services/svc-mcp-knowledge/package.json services/svc-mcp-knowledge/package.json
COPY --from=build /app/services/svc-mcp-knowledge/dist services/svc-mcp-knowledge/dist
# Nested (non-hoisted) deps live under the service's own node_modules — copy
# them too, else Node can't resolve them at runtime (ERR_MODULE_NOT_FOUND).
COPY --from=build /app/services/svc-mcp-knowledge/node_modules services/svc-mcp-knowledge/node_modules
WORKDIR /app/services/svc-mcp-knowledge
EXPOSE 3017
# `su-exec` shazuje práva po postavení mesh routy: entrypoint (v compose) začíná
# jako root, protože `ip route` vyžaduje NET_ADMIN. Táž dvojice jako u gateway.
RUN apk add --no-cache su-exec iproute2
# ⛔ ŽÁDNÉ `USER node` V OBRAZU. `AISHA_SHARED_REDIS_URL` míří na mesh jméno
# sdíleného Redisu (katalog internal_tcp_endpoints): bez routy do rozsahu peerů se
# PŘELOŽÍ a NESPOJÍ a každé volání, které Redis potřebuje, visí na timeoutu.
# Entrypoint postaví routu a teprve pak práva zahodí přes `exec su-exec node …`
# (hlídá brána `mesh-lane-miri-jmenem-ne-hopem`).
CMD ["node", "dist/server.js"]
