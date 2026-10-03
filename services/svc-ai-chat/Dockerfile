# syntax=docker/dockerfile:1
# svc-ai-chat — Fastify orchestration service (port 3011)
#
# Workspace-aware, registry-free build. Build CONTEXT = REPO ROOT
# (docker-compose.coolify-ai-chat.yml). @aisha/security, @aisha/aitg and
# @aisha/observability are monorepo WORKSPACE packages, resolved via npm
# workspace symlinks. No Verdaccio build-time dependency is needed for local
# cold starts or production rebuilds.

ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
# Whole repo so npm resolves the full workspace graph + symlinks @aisha/*.
COPY . .
RUN npm ci --workspace=@aisha/svc-ai-chat --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/postgrest-client && \
    npm run build --workspace=@aisha/aitg && \
    npm run build --workspace=@aisha/flowboard-core && \
    npm run build --workspace=@aisha/llm-dispatch && \
    npm run build --workspace=@aisha/acs-contracts && \
    npm run build --workspace=@aisha/acs-sdk && \
    npm run build --workspace=@aisha/svc-ai-chat
RUN npm prune --workspace=@aisha/svc-ai-chat --omit=dev
# Ensure the runtime COPY below never fails when all deps are root-hoisted.
RUN mkdir -p services/svc-ai-chat/node_modules
# Fail LOUD if the workspace-scoped prune above evicted a declared prod dep (it
# has misfired on deep trees — see svc-web-artifact/jsdom). Generic guard, no
# hardcoded names: build breaks here rather than crash-looping in prod.
RUN node scripts/verify-runtime-deps.mjs services/svc-ai-chat

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Root-hoisted node_modules + workspace package dirs required by symlinked
# @aisha/* dependencies.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/postgrest-client packages/postgrest-client
COPY --from=build /app/packages/aitg packages/aitg
# flowboard-core is a workspace dep (built above); its package dir must travel
# too, else node_modules/@aisha/flowboard-core's symlink target is absent at
# runtime → ERR_MODULE_NOT_FOUND (only `zod`, root-hoisted, so no nested deps).
COPY --from=build /app/packages/flowboard-core packages/flowboard-core
# llm-dispatch: workspace dep (the multi-provider backends). Its package dir must
# travel too, else node_modules/@aisha/llm-dispatch's symlink target is absent at
# runtime → ERR_MODULE_NOT_FOUND. Deps (@aisha/security, openai) are root-hoisted.
COPY --from=build /app/packages/llm-dispatch packages/llm-dispatch
# ACS workspace deps (IP-1/6/8/11): symlink targets must travel, else
# ERR_MODULE_NOT_FOUND once ACS_MODE != off loads @aisha/acs-sdk.
COPY --from=build /app/packages/acs-contracts packages/acs-contracts
COPY --from=build /app/packages/acs-sdk packages/acs-sdk
COPY --from=build /app/services/svc-ai-chat/package.json services/svc-ai-chat/package.json
COPY --from=build /app/services/svc-ai-chat/dist services/svc-ai-chat/dist
# Nested non-hoisted service deps must travel too.
COPY --from=build /app/services/svc-ai-chat/node_modules services/svc-ai-chat/node_modules
WORKDIR /app/services/svc-ai-chat
EXPOSE 3011
# Mesh routu staví entrypoint v compose JAKO ROOT a práva hned zahodí přes
# `exec su-exec node …` (vzor: gateway, brána mesh-lane-miri-jmenem-ne-hopem).
# ⛔ NAMĚŘENO 2026-09-16 na guru: s `USER node` v obrazu služba routu postavit
# nemohla, mesh jméno se přeložilo a NESPOJILO — svc-ai-chat vypršel na PostgREST,
# MCP, lokálním modelu, companion i integration, a nic to nehlásilo jako chybu.
RUN apk add --no-cache su-exec iproute2
CMD ["node", "dist/server.js"]
