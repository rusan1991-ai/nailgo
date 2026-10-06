/**
 * Общая обвязка: jsdom + бандл приложения + fetch, который ходит через Vite
 * (http://127.0.0.1:5173) — то есть ровно так, как это делает браузер предпросмотра.
 */
import fs from "fs";
import { JSDOM, VirtualConsole } from "jsdom";

export const ORIGIN = process.env.NAILGO_ORIGIN ?? "http://127.0.0.1:5173";
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
  const response = await fetch(`${ORIGIN}/api${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

/** Вход по коду: возвращает сессию для localStorage. */
export async function login(phone, name = "Тест Клиент") {
  const requested = await api("/auth/request-otp", { method: "POST", body: { phone } });
  const code = requested.data.devCode;
  const verified = await api("/auth/verify-otp", { method: "POST", body: { phone, code, name } });
  if (verified.status !== 200) throw new Error(`login failed: ${JSON.stringify(verified.data)}`);
  return { user: verified.data.user, accessToken: verified.data.accessToken };
}
