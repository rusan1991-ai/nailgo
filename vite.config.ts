import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
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
