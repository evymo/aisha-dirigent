# syntax=docker/dockerfile:1
# plugin-exec — isolated execution image for AISHA plugins
# Runs under Kata (production) or Docker (development) with:
#   - Read-only root filesystem
#   - Dropped capabilities
#   - No host filesystem access
#   - Resources limited by runner (memory, CPU)
#
# Entrypoint reads PLUGIN_PAYLOAD env and ctx.* calls go back to
# svc-plugin-system /sandbox/* broker via BROKER_URL + BROKER_TOKEN.

ARG REGISTRY_PROXY=
FROM ${REGISTRY_PROXY}library/node:22-alpine AS build
WORKDIR /app
COPY images/plugin-exec/shim/package.json ./
RUN npm install --ignore-scripts
COPY images/plugin-exec/shim/tsconfig.json ./
COPY images/plugin-exec/shim/src ./src
RUN npx tsc

FROM ${REGISTRY_PROXY}library/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY images/plugin-exec/shim/package.json ./
RUN npm install --ignore-scripts --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# dumb-init: proper signal handling + zombie reaping
RUN apk add --no-cache dumb-init

# Non-root user
USER node

ENTRYPOINT ["dumb-init", "--", "node", "dist/main.js"]
