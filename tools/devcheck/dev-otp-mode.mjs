/**
 * Integration check for the explicit fixed-code mode under NODE_ENV=production.
 * It starts an isolated API + PGlite database and needs no Vite, OAuth, or bot.
 *
 * Run: cd tools/devcheck && npm run dev-otp-mode
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "apps/api");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailgo-fixed-otp-"));
const databaseDir = path.join(tempDir, "pglite");
const port = 42000 + (process.pid % 16000);
const baseUrl = `http://127.0.0.1:${port}/api`;
let failures = 0;
let logs = "";

const check = (label, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` → ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const child = spawn("npm", ["run", "start"], {
  cwd: apiDir,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    DATABASE_URL: `pglite://${databaseDir}`,
    AUTO_SEED_ON_EMPTY: "true",
    DEV_OTP_ENABLED: "true",
    OTP_DELIVERY: "dev",
    OTP_TTL_SECONDS: "300",
    DELIVERY_INTERVAL_SECONDS: "0",
    SCHEDULER_INTERVAL_SECONDS: "0",
    JWT_ACCESS_SECRET: "nailgo-devcheck-access-secret-123456789",
    JWT_REFRESH_SECRET: "nailgo-devcheck-refresh-secret-123456789",
    OTP_PEPPER: "nailgo-devcheck-otp-pepper-123456789",
    YANDEX_CLIENT_ID: "",
    VK_CLIENT_ID: "",
    TELEGRAM_BOT_TOKEN: "",
    MAX_BOT_TOKEN: "",
  },
});

const appendLog = (chunk) => {
  logs = `${logs}${chunk}`.slice(-8000);
};
child.stdout.setEncoding("utf8").on("data", appendLog);
child.stderr.setEncoding("utf8").on("data", appendLog);
let childExit = null;
child.once("exit", (code, signal) => {
  childExit = { code, signal };
});

async function request(route, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    // An invalid JSON response will fail the assertions below with its status.
  }
  return { status: response.status, data };
}

async function stopApi() {
  if (childExit !== null || !child.pid) return;
  try {
    // npm starts Node as a child, so terminate the detached process group.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(6000),
  ]);
  if (childExit === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

try {
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && childExit === null) {
    try {
      const health = await request("/health");
      if (health.status === 200 && health.data?.ok === true) {
        ready = true;
        break;
      }
    } catch {
      // The API is still migrating/bootstrapping. Continue until ready or timeout.
    }
    await wait(400);
  }

  check(
    "изолированный API стартует с NODE_ENV=production и отдельной PGlite-базой",
    ready,
    ready ? `port=${port}` : `${JSON.stringify(childExit)} ${logs.slice(-1000)}`,
  );

  if (ready) {
    const providers = await request("/auth/providers");
    const phoneProvider = providers.data?.items?.find((item) => item.provider === "phone");
    check(
      "телефонный OTP доступен по явным флагам без настроенных внешних провайдеров",
      providers.status === 200 && phoneProvider?.available === true,
      `status=${providers.status}, phone=${phoneProvider?.available}`,
    );

    const annaPhone = "+79990000001";
    const annaCode = await request("/auth/request-otp", {
      method: "POST",
      body: { phone: annaPhone },
    });
    check(
      "OTP_DELIVERY=dev возвращает фиксированный четырёхзначный код 1234 вне development",
      annaCode.status === 200 && annaCode.data?.devCode === "1234" &&
        annaCode.data?.message?.includes("1234"),
      `status=${annaCode.status}, code=${annaCode.data?.devCode}`,
    );

    const annaSession = await request("/auth/verify-otp", {
      method: "POST",
      body: { phone: annaPhone, code: "1234", mode: "dev_login", role: "master" },
    });
    check(
      "код 1234 выдаёт JWT-сессию мастера Анны Смирновой",
      annaSession.status === 200 && annaSession.data?.user?.name === "Анна Смирнова" &&
        annaSession.data?.user?.role === "master" && annaSession.data?.user?.phone === annaPhone &&
        Boolean(annaSession.data?.accessToken) && Boolean(annaSession.data?.refreshToken),
      `status=${annaSession.status}, user=${JSON.stringify(annaSession.data?.user ?? null)}`,
    );

    const clientPhone = `+7988${String(Date.now()).slice(-7)}`;
    const clientCode = await request("/auth/request-otp", {
      method: "POST",
      body: { phone: clientPhone },
    });
    const clientSession = await request("/auth/verify-otp", {
      method: "POST",
      body: { phone: clientPhone, code: "1234", mode: "dev_login", role: "client" },
    });
    check(
      "код 1234 создаёт клиента и выдаёт ему JWT без OAuth или Telegram",
      clientCode.status === 200 && clientCode.data?.devCode === "1234" &&
        clientSession.status === 200 && clientSession.data?.user?.role === "client" &&
        clientSession.data?.user?.phone === clientPhone && Boolean(clientSession.data?.accessToken),
      `code=${clientCode.data?.devCode}, login=${clientSession.status}, role=${clientSession.data?.user?.role}`,
    );

    const registerPhone = `+7977${String(Date.now()).slice(-7)}`;
    const registerCode = await request("/auth/request-otp", {
      method: "POST",
      body: { phone: registerPhone },
    });
    const registration = await request("/auth/verify-otp", {
      method: "POST",
      body: { phone: registerPhone, code: "1234", mode: "register", role: "client", name: "Тестовая клиентка" },
    });
    check(
      "форма регистрации также принимает код 1234 и получает сессию",
      registerCode.status === 200 && registerCode.data?.devCode === "1234" &&
        registration.status === 200 && registration.data?.user?.role === "client" &&
        registration.data?.user?.name === "Тестовая клиентка" && Boolean(registration.data?.accessToken),
      `code=${registerCode.data?.devCode}, registration=${registration.status}`,
    );
  }
} catch (error) {
  check("фиксированный OTP integration check не завершается исключением", false, String(error));
} finally {
  await stopApi();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} fixed OTP check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nProduction NODE_ENV fixed OTP checks passed.");
}
