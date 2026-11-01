# FILE106 ARCHIVE — application image.
#
# One process, no build step: Fastify serves server-rendered HTML and the
# existing public files in site/. Dependencies are installed once in a builder
# stage so the runtime image carries no toolchain, and the container runs as the
# unprivileged `node` user.

FROM node:24-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


FROM node:24-alpine AS runtime

# Production mode is a hard requirement, not a preference: config.js refuses to
# boot without real SESSION_SECRET / ANSWER_ENC_KEY values when NODE_ENV is
# production, instead of generating throwaway ones.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY app ./app
COPY site ./site
COPY db/migrations ./db/migrations

USER node
EXPOSE 3000

# Readiness, not liveness: /healthz answers 200 only when the server is up. The
# database is exercised by the first real request, so a db outage does not get
# the container killed in a loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "app/index.js"]
