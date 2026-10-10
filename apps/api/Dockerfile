# API production image. Build from repository root:
#   docker build -f apps/api/Dockerfile .
# Runtime uses node-postgres for DATABASE_URL=postgresql://...; migrations run
# from the compiled API on every start and are safe to repeat.

FROM node:22-alpine AS build
WORKDIR /app

COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build

# --- minimal production runtime ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000
WORKDIR /app

COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node apps/api/drizzle ./drizzle
RUN mkdir -p /data/media && chown node:node /data/media

USER node
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
