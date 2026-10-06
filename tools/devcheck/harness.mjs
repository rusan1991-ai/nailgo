/**
 * Общая обвязка: jsdom + бандл приложения + fetch, который ходит через Vite
 * (http://127.0.0.1:5173) — то есть ровно так, как это делает браузер предпросмотра.
 */
import fs from "fs";
import { JSDOM, VirtualConsole } from "jsdom";

export const ORIGIN = process.env.NAILGO_ORIGIN ?? "http://127.0.0.1:5173";

/** Демо-мастер из сидов API: его номер открывает кабинет /pro. */
export const MASTER_PHONE = "+79990000001";
export const BUNDLE = fs.readFileSync(new URL("./bundle.js", import.meta.url), "utf8");

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function makeDom(route, { session, storage = {} } = {}) {
  const errors = [];
  const consoleErrors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => errors.push(error.message));
  vc.on("error", (...args) => consoleErrors.push(String(args[0])));

  const dom = new JSDOM(
    `<!doctype html><html lang="ru"><body><div id="root"></div><script>${BUNDLE}</script></body></html>`,
    {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      url: `${ORIGIN}${route}`,
      virtualConsole: vc,
      beforeParse(window) {
        window.matchMedia = (query) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent: () => false,
        });
        window.ResizeObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
        window.IntersectionObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
        };
        window.scrollTo = () => {};
        // Запросы уходят на Vite-прокси: браузер и jsdom ведут себя одинаково.
        window.fetch = (input, init) => fetch(new URL(String(input), ORIGIN).toString(), init);
        if (session) window.localStorage.setItem("nailgo_auth_user", JSON.stringify(session));
        for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
      },
    },
  );

  return { dom, errors, consoleErrors, window: dom.window };
}

export const rootText = (dom) =>
  (dom.window.document.getElementById("root")?.textContent ?? "").replace(/\s+/g, " ").trim();

export const rootHtmlLength = (dom) =>
  dom.window.document.getElementById("root")?.innerHTML.length ?? 0;

export function findButton(dom, text) {
  return [...dom.window.document.querySelectorAll("button, a")].find((element) =>
    (element.textContent ?? "").replace(/\s+/g, " ").includes(text),
  );
}

/** Строка таблицы, в которой встречаются все указанные фрагменты. */
export function rowByText(dom, ...parts) {
  return [...dom.window.document.querySelectorAll("tr")].find((row) => {
    const text = (row.textContent ?? "").replace(/\s+/g, " ");
    return parts.every((part) => text.includes(part));
  });
}

/**
 * Клик по кнопке действия внутри самой узкой карточки с указанным текстом.
 * Нужен там, где на странице несколько одинаковых кнопок (например, «Опубликовать»).
 */
export function clickActionIn(dom, text, actionLabel) {
  const scopes = [...dom.window.document.querySelectorAll("div")]
    .filter((node) => (node.textContent ?? "").includes(text))
    .reverse();

  for (const scope of scopes) {
    const button = [...scope.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes(actionLabel),
    );
    if (button) {
      button.click();
      return true;
    }
  }
  return false;
}

/** Клик по кнопке внутри конкретного элемента (например, внутри строки таблицы). */
export function clickIn(scope, text) {
  if (!scope) throw new Error(`нет элемента, внутри которого ищем «${text}»`);
  const element = [...scope.querySelectorAll("button, a")].find((candidate) =>
    (candidate.textContent ?? "").replace(/\s+/g, " ").includes(text),
  );
  if (!element) throw new Error(`не найден элемент с текстом «${text}»`);
  element.click();
  return element;
}

export function click(dom, text) {
  const element = findButton(dom, text);
  if (!element) throw new Error(`не найден элемент с текстом «${text}»`);
  element.click();
  return element;
}

/** React слушает input-события, поэтому ставим значение через нативный сеттер. */
export function setField(dom, placeholder, value) {
  const input = [...dom.window.document.querySelectorAll("input, textarea")].find(
    (element) => element.getAttribute("placeholder") === placeholder,
  );
  if (!input) throw new Error(`не найдено поле «${placeholder}»`);
  const prototype = input.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

export function check(label, ok, extra = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra ? ` → ${extra}` : ""}`);
  return ok;
}

export async function api(path, init) {
  const hasBody = init?.body !== undefined;
  const response = await fetch(`${ORIGIN}/api${path}`, {
    ...init,
    // content-type ставим только при теле: пустой POST с JSON-заголовком
    // Fastify отвергает (400 empty_body).
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

/**
 * Запрос к API от имени сессии: кабинетные ручки требуют
 * заголовок Authorization: Bearer <token>.
 */
export async function apiAs(session, path, init) {
  return api(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${session.accessToken}` },
  });
}

/** Сессия мастера — для страниц кабинета, закрытых ролевым гейтом. */
export async function loginMaster() {
  return login(MASTER_PHONE, "Анна Смирнова");
}

/** Вход по коду: возвращает сессию для localStorage. */
export async function login(phone, name = "Тест Клиент") {
  const requested = await api("/auth/request-otp", { method: "POST", body: { phone } });
  const code = requested.data.devCode;
  const verified = await api("/auth/verify-otp", { method: "POST", body: { phone, code, name } });
  if (verified.status !== 200) throw new Error(`login failed: ${JSON.stringify(verified.data)}`);
  return { user: verified.data.user, accessToken: verified.data.accessToken };
}

/**
 * Сброс демо-данных через API (только dev-окружение). Сквозные проверки
 * начинают с одного и того же состояния: иначе повторные прогоны забивают
 * свободные окна демо-дня и проверка «есть свободный слот» падает.
 */
export async function resetDemo(masterSession) {
  const result = await apiAs(masterSession, "/cabinet/demo/reset", { method: "POST" });
  if (result.status !== 200) {
    throw new Error(`Сброс демо-данных не удался: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result.data;
}
