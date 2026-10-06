# Прод-образ API: сборка TypeScript и запуск скомпилированного сервера.
#
# Собирается из корня репозитория: docker build -f apps/api/Dockerfile .
# База — внешний Postgres (DATABASE_URL), миграции накатываются при старте
# (server.ts вызывает runMigrations перед listen, повторный запуск безопасен).

FROM node:22-alpine AS build
WORKDIR /app

COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci

COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build

# --- runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY apps/api/package.json apps/api/package-lock.json ./
# @electric-sql/pglite ставится как необязательный peer drizzle-orm, но нужен
# только локальной базе: при DATABASE_URL=postgres:// код его не загружает
# (см. apps/api/src/db/index.ts), поэтому из прод-образа его убираем.
RUN npm ci --omit=dev \
  && rm -rf node_modules/@electric-sql \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
# Миграции нужны и в рантайме: сервер накатывает их при старте.
COPY apps/api/drizzle ./drizzle

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
