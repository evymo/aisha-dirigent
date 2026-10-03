# gateway — API gateway / PostgREST + service router (port 3001)
#
# Workspace-aware build. NO Verdaccio auth: internal packages
# (@aisha/security) resolve via npm workspaces (symlinks). Build context
# is REPO ROOT — set in docker-compose.coolify.yml.
#
# Strategy: install + build EVERYTHING in the build stage, then copy the
# resolved node_modules + built artifacts into the runtime image. Avoids
# re-running `npm ci` in the runtime stage (which fires `prepare`
# lifecycle scripts of every workspace member). Same effect as
# `npm prune --omit=dev` but without the scope-resolution dance that bit
# the old inline-Dockerfile + .npmrc approach.

ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
COPY . .
# Install only this service's workspace + root deps. --workspace flag
# narrows scope so prepare scripts of unrelated workspaces don't fire.
RUN npm ci --workspace=@aisha/gateway --include-workspace-root --include=dev --ignore-scripts
# Build deps in order, then this service.
# @aisha/observability must be built before @aisha/gateway (gateway's server.ts
# imports @aisha/observability/otel + @aisha/observability/metrics).
RUN npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/cache-redis && \
    npm run build --workspace=@aisha/knock-protocol && \
    npm run build --workspace=@aisha/gateway
# Prune dev deps for this workspace only.
RUN npm prune --workspace=@aisha/gateway --omit=dev
# Guarantee the service's own node_modules dir exists so the runtime COPY below
# never fails — and carries any dep npm nested HERE instead of hoisting to root.
RUN mkdir -p services/gateway/node_modules
# Fail LOUD if the workspace-scoped prune above evicted a declared prod dep (it
# has misfired on deep trees — see svc-web-artifact/jsdom). Generic guard, no
# hardcoded names: build breaks here rather than crash-looping in prod.
RUN node scripts/verify-runtime-deps.mjs services/gateway

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Copy the already-resolved node_modules + built dist files from build.
# node_modules contains symlinks node_modules/@aisha/security →
# ../../packages/security (relative to root), so we ALSO need the
# package directory to exist with its dist/ subfolder.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/security/package.json packages/security/package.json
COPY --from=build /app/packages/security/dist packages/security/dist
COPY --from=build /app/packages/observability/package.json packages/observability/package.json
COPY --from=build /app/packages/observability/dist packages/observability/dist
# @aisha/observability's dist/otel.js staticky importuje @opentelemetry/* při
# načtení. Když chybí, gateway spadne na ERR_MODULE_NOT_FOUND, /health se nikdy
# nenaváže, kontejner je unhealthy a nasazení padne. Ten NÁROK platí dál.
#
# ⛔ NAMĚŘENO 2026-08-12: tady stálo
#   COPY --from=build /app/packages/observability/node_modules …
# s odůvodněním „otel se NEhoistuje do kořene, npm ho vnořuje — viz záznam
# packages/observability/node_modules/@opentelemetry/… v lockfile".
# Ta premisa PADLA: po konvergenci forků (registrace broker-kitu jako
# workspace + přepočet lockfile) se otel dedupuje a hoistuje do kořene.
# V lockfile je dnes vnořených záznamů NULA. Cesta tedy v build stage
# neexistuje a COPY selže:
#   failed to compute cache key: "/app/packages/observability/node_modules": not found
# Padl na tom celý build core (compose je JEDEN CELEK) — dvakrát po sobě,
# nasazení uenukl7d… i e72qiokl…
#
# Kořenové node_modules kopíruje už řádek výš, takže otel je v obrazu
# doručený TAK JAKO TAK. Místo kopie vázané na JEDEN layout se proto tvrdí
# VÝSLEDEK: balíčky musí jít rozresolvovat. Hoisting se smí měnit, nárok ne —
# a když se rozbije, ozve se to při BUILDU se jménem chybějícího balíčku,
# ne až nezdravým kontejnerem v produkci.
RUN node -e "for (const m of ['@opentelemetry/api','@opentelemetry/sdk-node','@opentelemetry/auto-instrumentations-node','@opentelemetry/exporter-trace-otlp-http','prom-client']) { try { require.resolve(m) } catch { console.error('[gateway] CHYBÍ runtime závislost observability: ' + m + ' — dist/otel.js ji importuje staticky, kontejner by nabootoval do unhealthy'); process.exit(1) } }"
COPY --from=build /app/packages/cache-redis/package.json packages/cache-redis/package.json
COPY --from=build /app/packages/cache-redis/dist packages/cache-redis/dist
COPY --from=build /app/packages/knock-protocol/package.json packages/knock-protocol/package.json
COPY --from=build /app/packages/knock-protocol/dist packages/knock-protocol/dist
COPY --from=build /app/services/gateway/package.json services/gateway/package.json
COPY --from=build /app/services/gateway/dist services/gateway/dist
# Nested (non-hoisted) deps live under the service's own node_modules — copy
# them too, else Node can't resolve them at runtime (ERR_MODULE_NOT_FOUND).
COPY --from=build /app/services/gateway/node_modules services/gateway/node_modules
# npm workspaces hoist deps to ROOT /app/node_modules/ — services don't
# get their own node_modules. Node's resolution traverses up from
# /app/services/gateway to /app/node_modules automatically.
WORKDIR /app/services/gateway
EXPOSE 3001
# `su-exec` shazuje práva po postavení mesh routy: entrypoint (v compose) musí
# začít jako root, protože `ip route` vyžaduje NET_ADMIN, který neprivilegovaný
# uživatel nedostane. Táž dvojice jako u event-worker a svc-ide-context.
RUN apk add --no-cache su-exec iproute2
# ⛔ ŽÁDNÉ `USER node` V OBRAZU (naměřeno 2026-09-07). Brána ověřuje odvolání
# tokenu (`jti`) v SDÍLENÉM Redisu pod MESH jménem, a ta kontrola je fail-closed.
# Bez routy do rozsahu peerů se jméno PŘELOŽÍ a NESPOJÍ, kontrola visí na
# timeoutu a brána odmítne KAŽDÝ token — navenek jako `invalid_keycloak_token`,
# v konzoli jako `CORS policy`, v síti jako 401 po 14–28 sekundách. Ani jeden
# z těch tří příznaků neukazuje na chybějící routu; plocha zůstane prázdná.
# Entrypoint proto začíná jako root, postaví routu a teprve pak práva zahodí
# přes `exec su-exec node …`. Práva NESMÍ zůstat rootovská — hlídá brána
# `mesh-lane-miri-jmenem-ne-hopem`.
CMD ["node", "dist/server.js"]
