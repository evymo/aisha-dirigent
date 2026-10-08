# syntax=docker/dockerfile:1
# svc-lane-klient — tenký klient společné lane (svc-model tenkého stacku forku na GPU uzlu).
#
# Registry-free workspace build, CONTEXT = KOŘEN REPA (jako ostatní služby).
#
# ⭐ V OBRAZU ANI V ENV NENÍ ŽÁDNÝ KLÍČ (K1, podmínka Aishy 6)
# Klíč lane drží jen dispatch forku; klient hlavičku Authorization jen propustí.
ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace=@aisha/svc-lane-klient --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/accel-protokol && \
    npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/svc-lane-klient
RUN rm -rf node_modules services/svc-lane-klient/node_modules \
 && npm ci --workspace=@aisha/svc-lane-klient --omit=dev --ignore-scripts
RUN mkdir -p services/svc-lane-klient/node_modules
RUN node scripts/verify-runtime-deps.mjs services/svc-lane-klient

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/accel-protokol packages/accel-protokol
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/services/svc-lane-klient/package.json services/svc-lane-klient/package.json
COPY --from=build /app/services/svc-lane-klient/dist services/svc-lane-klient/dist
COPY --from=build /app/services/svc-lane-klient/node_modules services/svc-lane-klient/node_modules
WORKDIR /app/services/svc-lane-klient
# 8000 = peery modelového meshe (0.0.0.0, přijímá jen spojení z rozsahu meshe — prijem.ts);
# 8081 = správa jen na 127.0.0.1 (zdraví pro sondu kontejneru, metriky). Ven se nepublikuje nic.
EXPOSE 8000 8081
# ⭐ Běží jako `node`, ne root. Síť (rozhraní meshe, lane) patří agentovi meshe, v jehož
# jmenném prostoru klient sedí; klient sám nemá NET_ADMIN ani /dev/net/tun.
USER node
CMD ["node", "dist/server.js"]
