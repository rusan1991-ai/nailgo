/**
 * Собирает приложение в один IIFE-бандл, который можно выполнить в jsdom.
 * import.meta.env подменяем — в IIFE его нет.
 *
 * Запуск: node tools/devcheck/bundle.mjs
 */
import path from "node:path";
import { build } from "esbuild";

// Пути считаем от корня репозитория, а не от текущего каталога:
// скрипт должен работать и из корня, и из tools/devcheck.
const here = import.meta.dirname;
const repoRoot = path.resolve(here, "..", "..");

const result = await build({
  entryPoints: [path.join(repoRoot, "src/main.tsx")],
  bundle: true,
  format: "iife",
  outfile: path.join(here, "bundle.js"),
  jsx: "automatic",
  loader: { ".css": "empty", ".png": "empty", ".svg": "empty" },
  define: {
    "process.env.NODE_ENV": '"development"',
    "import.meta.env": '{"MODE":"development","DEV":true,"PROD":false,"VITE_API_URL":"/api"}',
  },
  logLevel: "warning",
});

if (result.errors.length > 0) {
  console.error(result.errors);
  process.exit(1);
}
console.log("bundled → tools/devcheck/bundle.js");
