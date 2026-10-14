import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import postcssCascadeLayers from "@csstools/postcss-cascade-layers";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
// Extra hostnames the dev server may answer to (comma-separated).
// Needed when the app is served through a tunnel / preview proxy.
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  // Tailwind v4 emits cascade layers. Safari/iOS before 15.4 ignores @layer,
  // which drops most utility CSS. Flatten layers after Tailwind has generated
  // the complete stylesheet and before vite-plugin-singlefile inlines it.
  css: {
    postcss: {
      plugins: [postcssCascadeLayers()],
    },
  },
  build: {
    // Keep the application parseable by iOS 14+ / Safari 14+ WebKit.
    target: ["es2020", "edge88", "firefox78", "chrome87", "safari14", "ios14"],
    // CSS minification target; cascade-layer compatibility is handled above.
    cssTarget: "safari14",
  },
  // Safari 14 supports object/array destructuring, but esbuild's target table
  // currently marks it as unsupported and otherwise refuses to transpile it.
  esbuild: {
    supported: { destructuring: true },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    // Если список хостов не задан, отвечаем на любой Host: окно предпросмотра
    // открывается по адресу вида <порт>-<id>.e2b.app, и точный хост заранее
    // неизвестен. Нужен строгий список — задайте VITE_ALLOWED_HOSTS.
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : true,
    // Браузер в окне предпросмотра обращается только к этому серверу,
    // запросы к API уходят через прокси — без localhost из клиента.
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
