# syntax=docker/dockerfile:1
# svc-knock — naslouchá zaťukání na veřejném UDP portu a zapisuje otevřené
# adresy do sdílené mapy dveří.
#
# Registry-free workspace build, CONTEXT = KOŘEN REPA (jako ostatní služby).
#
# ⭐ V OBRAZU NENÍ ŽÁDNÉ TAJEMSTVÍ
# Roster operátorů (klíče, OTP seedy) se sem NEKOPÍRUJE — přichází za běhu
# v `SPA_OPERATORS_B64` / `SPA_OPERATORS_FILE`. Rotace pověření je tak změna
# hodnoty a restart, ne přestavba obrazu, kterou by nikdo nedělal a tajemství
# by stárlo spolu s ním.
ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace=@aisha/svc-knock --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/knock-protocol && \
    npm run build --workspace=@aisha/cache-redis && \
    npm run build --workspace=@aisha/svc-knock
RUN rm -rf node_modules services/svc-knock/node_modules \
 && npm ci --workspace=@aisha/svc-knock --omit=dev --ignore-scripts
RUN mkdir -p services/svc-knock/node_modules
RUN node scripts/verify-runtime-deps.mjs services/svc-knock

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/packages/knock-protocol packages/knock-protocol
COPY --from=build /app/packages/cache-redis packages/cache-redis
COPY --from=build /app/services/svc-knock/package.json services/svc-knock/package.json
COPY --from=build /app/services/svc-knock/dist services/svc-knock/dist
COPY --from=build /app/services/svc-knock/node_modules services/svc-knock/node_modules
WORKDIR /app/services/svc-knock
EXPOSE 18181/udp
EXPOSE 3017
# ⭐ Běží jako `node`, ne root. Tahle služba jako jediná ve stacku poslouchá na
# VEŘEJNÉM UDP portu, takže je to první místo, kam se někdo obuje — a nemá mít
# ani o krok víc práv, než potřebuje. Port 18181 je nad 1024, takže se dá
# navázat bez privilegií; nic dalšího služba nedělá (žádný ipset, žádné
# NET_ADMIN — mapu dveří vynucuje ten, kdo obsluhuje požadavek).
USER node
CMD ["node", "dist/server.js"]
