# syntax=docker/dockerfile:1
# svc-accel-vstup — vynucovací bod společné lane na GPU uzlu (jediný na sítích nájemců).
#
# Registry-free workspace build, CONTEXT = KOŘEN REPA (jako ostatní služby).
#
# ⭐ V OBRAZU NENÍ ŽÁDNÉ TAJEMSTVÍ ANI KLÍČ NÁJEMCE
# Deklarace uzlu (nájemci, otisky klíčů, kvóty) přichází za běhu jako soubor ve
# svazku; VB ji vyměňuje bez restartu. Klíče nájemců VB nezná vůbec — jen otisky.
ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace=@aisha/svc-accel-vstup --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/accel-protokol && \
    npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/svc-accel-vstup
RUN rm -rf node_modules services/svc-accel-vstup/node_modules \
 && npm ci --workspace=@aisha/svc-accel-vstup --omit=dev --ignore-scripts
RUN mkdir -p services/svc-accel-vstup/node_modules
RUN node scripts/verify-runtime-deps.mjs services/svc-accel-vstup

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/accel-protokol packages/accel-protokol
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/services/svc-accel-vstup/package.json services/svc-accel-vstup/package.json
COPY --from=build /app/services/svc-accel-vstup/dist services/svc-accel-vstup/dist
COPY --from=build /app/services/svc-accel-vstup/node_modules services/svc-accel-vstup/node_modules
WORKDIR /app/services/svc-accel-vstup
# 8000 = nájemci na sítích lane; 8081 = správa jen na 127.0.0.1 (zdraví, metriky). Ven se nepublikuje nic.
EXPOSE 8000 8081
# ⭐ Běží jako `node`, ne root, bez NET_ADMIN a bez /dev/net/tun: VB nic nezahajuje
# (jen spojení na enginy jádra) a do meshe nepatří (O8, M6).
USER node
CMD ["node", "dist/server.js"]
