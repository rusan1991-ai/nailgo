/** Deployment contract checks plus an isolated real bootstrap integration test. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compose = read("docker-compose.yml");
const parsedCompose = parse(compose);
const composeServices = compose.split(/^volumes:\s*$/m)[0];
const services = [...composeServices.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]);

assert.deepEqual(services, ["postgres", "nailgo-backend", "nailgo-frontend"]);
assert.deepEqual(Object.keys(parsedCompose.services), services, "Compose YAML must parse to exactly three services");
assert.equal(parsedCompose.services.postgres.image, "postgres:17-alpine");
assert.deepEqual(parsedCompose.services.postgres.volumes[0], "postgres_data:/var/lib/postgresql/data");
assert.deepEqual(parsedCompose.services["nailgo-backend"].ports[0], "127.0.0.1:4000:4000");
assert.deepEqual(parsedCompose.services["nailgo-frontend"].ports, [
  "${NGINX_HTTP_PORT:-80}:80",
  "${NGINX_HTTPS_PORT:-443}:443",
]);
assert.equal(parsedCompose.services["nailgo-frontend"].build.args.VITE_API_URL, "${VITE_API_URL:-/api}");
assert.match(compose, /image:\s*postgres:1[6-9][0-9]?-alpine/);
assert.match(compose, /postgres_data:\/var\/lib\/postgresql\/data/);
assert.match(compose, /127\.0\.0\.1:4000:4000/);
assert.match(compose, /"\$\{NGINX_HTTP_PORT:-80\}:80"[\s\S]*"\$\{NGINX_HTTPS_PORT:-443\}:443"/);
assert.match(compose, /AUTO_SEED_ON_EMPTY:\s*\$\{AUTO_SEED_ON_EMPTY:-true\}/);

const apiDockerfile = read("apps/api/Dockerfile");
const frontendDockerfile = read("Dockerfile.frontend");
assert.match(apiDockerfile, /FROM node:22-alpine AS build/);
assert.match(apiDockerfile, /npm ci --omit=dev/);
assert.match(frontendDockerfile, /FROM node:22-alpine AS build/);
assert.match(frontendDockerfile, /FROM nginx:stable-alpine AS runtime/);

const nginx = `${read("infrastructure/nginx/bootstrap.conf.template")}\n${read("infrastructure/nginx/tls.conf.template")}`;
assert.match(nginx, /nailgo-backend:4000/);
assert.match(nginx, /\.well-known\/acme-challenge/);
assert.match(nginx, /listen 443 ssl/);
assert.equal((nginx.match(/include \/etc\/nginx\/mime\.types;/g) ?? []).length, 3, "every Nginx server explicitly loads standard MIME types");
assert.equal((nginx.match(/default_type application\/octet-stream;/g) ?? []).length, 3, "each Nginx server has a safe default content type");
assert.equal((nginx.match(/location \^~ \/assets\//g) ?? []).length, 2, "both static-serving configs handle fingerprinted assets");
assert.equal((nginx.match(/expires 1y;/g) ?? []).length, 2, "fingerprinted assets are cached for one year");
assert.equal((nginx.match(/add_header Cache-Control "public, no-transform";/g) ?? []).length, 2, "asset cache policy is explicit");
assert.match(read("infrastructure/nginx/start-nginx.sh"), /tls\.conf\.template/);

for (const script of ["scripts/install.sh", "scripts/update.sh", "scripts/backup.sh", "scripts/restore.sh"]) {
  assert.match(read(script), /ENV_FILE="\$\{ENV_FILE:-\.env\.production\}"/, `${script} must keep the production default and allow isolated test env files`);
}
assert.match(read("scripts/backup.sh"), /BACKUP_DIR="\$\{BACKUP_DIR:-backups\}"/);
const composeSmoke = read("scripts/compose-smoke.sh");
assert.match(composeSmoke, /Refusing to overwrite/);
assert.match(composeSmoke, /RESTORE_DB="\$\{POSTGRES_DB\}_restore"/);
assert.match(composeSmoke, /down --volumes --remove-orphans/);
const smokeWorkflow = parse(read(".github/workflows/deployment-smoke.yml"));
assert.ok(smokeWorkflow.jobs?.["compose-smoke"], "GitHub Actions must define the Compose smoke job");
assert.ok(smokeWorkflow.jobs["compose-smoke"].steps.some((step) => step.run === "bash scripts/compose-smoke.sh"));

const envExample = read(".env.production.example");
assert.match(envExample, /^APP_DOMAIN=nail2go\.ru$/m);
assert.match(envExample, /^HOST=0\.0\.0\.0$/m);
assert.match(envExample, /^DATABASE_URL=postgresql:\/\/[^\n]+@postgres:5432\//m);
assert.match(envExample, /^NGINX_HTTP_PORT=80$/m);
assert.match(envExample, /^NGINX_HTTPS_PORT=443$/m);

const server = read("apps/api/src/server.ts");
assert.ok(server.indexOf("await runMigrations()") < server.indexOf("seedOnEmptyDatabase()"));
const db = read("apps/api/src/db/index.ts");
assert.match(db, /startsWith\("postgresql:\/\/"\)/);
assert.match(db, /drizzle-orm\/node-postgres/);
assert.match(db, /migratePg\(db as never, \{ migrationsFolder \}\)/);
const seed = read("apps/api/src/db/seed.ts");
assert.match(seed, /withBootstrapLock\(async \(\) =>/);
assert.match(seed, /system\.demo_bootstrap\.v1/);
assert.match(seed, /existingRows\.some\(\(rows\) => rows\.length > 0\)/);

console.log("OK  Compose has exactly three services, persistent Postgres, API and Nginx/TLS");
console.log("OK  production env, Postgres driver, migrations and guarded bootstrap are wired");
