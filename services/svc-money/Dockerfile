# syntax=docker/dockerfile:1
# svc-money — přístup do účetnictví Money S5 (za VPN), per agenda.
#
# Registry-free workspace build, CONTEXT = KOŘEN REPA (jako ostatní služby).
#
# ⭐ V OBRAZU NENÍ ŽÁDNÉ TAJEMSTVÍ
# Profil s klientským certifikátem, přihlašovací údaje tunelu ani pověření k API
# se sem NEKOPÍRUJÍ. Všechno přichází v proměnných za běhu a zapisuje se jen do
# tmpfs `/run/money`. Rotace certifikátu je tak změna hodnoty a restart —
# ne přestavba obrazu, která se odkládá tak dlouho, až tajemství zestárne.
ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace=@aisha/svc-money --include-workspace-root --include=dev --ignore-scripts
RUN npm run build --workspace=@aisha/observability && \
    npm run build --workspace=@aisha/security && \
    npm run build --workspace=@aisha/svc-money
RUN rm -rf node_modules services/svc-money/node_modules \
 && npm ci --workspace=@aisha/svc-money --omit=dev --ignore-scripts
RUN mkdir -p services/svc-money/node_modules
RUN node scripts/verify-runtime-deps.mjs services/svc-money

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# openvpn drží tunel, iproute2 kvůli `ip` (openvpn ho volá při --script-security 1;
# bez něj tunel NIKDY nenaběhne — doložená past z 2026-07-25).
RUN apk add --no-cache openvpn iproute2
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/observability packages/observability
COPY --from=build /app/packages/security packages/security
COPY --from=build /app/services/svc-money/package.json services/svc-money/package.json
COPY --from=build /app/services/svc-money/dist services/svc-money/dist
COPY --from=build /app/services/svc-money/node_modules services/svc-money/node_modules
WORKDIR /app/services/svc-money
EXPOSE 3016
# ⚠️ BEZ `USER node`: openvpn potřebuje NET_ADMIN a /dev/net/tun. Kontejner se
# proto spouští s `cap_add: [NET_ADMIN]` a `devices: [/dev/net/tun]` — a NIČÍM
# navíc (`cap_drop: ALL`), aby zvýšené právo zůstalo jediné a pojmenované.
CMD ["node", "dist/server.js"]
