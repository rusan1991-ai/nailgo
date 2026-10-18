/**
 * Вход «в один клик»: Яндекс ID, VK ID и мессенджеры.
 *
 * Платных SMS у площадки нет, поэтому этот блок — основной способ входа,
 * а форма с телефоном остаётся запасным (и на стенде — рабочим) вариантом.
 * Выбранную роль («клиент»/«мастер») блок передаёт на сервер: аккаунт мастера
 * создаётся сразу в своём кабинете.
 */
import { useEffect, useState } from "react";
import { authApi, waitForBotLogin, type AuthProvider } from "../api/auth2";
import type { LoginRole } from "../auth/AuthContext";

/** Заголовки кнопок: у провайдеров свои цвета, узнаваемые с первого взгляда. */
const STYLES: Record<string, string> = {
  vk: "border-[#0077ff] bg-[#0077ff] text-white hover:border-[#0066df] hover:bg-[#0066df]",
  yandex: "border-[#e9dfdc] bg-white text-[#342a27] hover:border-[#E58E82]",
  telegram: "border-[#d5edf7] bg-[#f5fbfe] text-[#236d8c] hover:border-[#229ed9]",
  max: "border-[#ead9ed] bg-[#fcf7fd] text-[#71317b] hover:border-[#8e3b9c]",
};

const ICONS: Record<string, string> = {
  yandex: "Я",
  vk: "VK",
  telegram: "TG",
  max: "M",
};

export type QuickLoginProps = {
  /** Роль, выбранная в форме: с ней создаётся аккаунт при первом входе. */
  role: LoginRole;
  /** Куда вернуться после входа (из query `returnTo`). */
  returnTo?: string | null;
  /** Колбэк для тестов и для случая, когда сессию выдал сам браузер. */
  onError?: (message: string) => void;
};

export function QuickLogin({ role, returnTo, onError }: QuickLoginProps) {
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void authApi
      .providers()
      .then((response) => {
        if (alive) setProviders(response.items);
      })
      .catch(() => {
        // Список кнопок — не критичный ресурс: без него остается форма с кодом.
        if (alive) setProviders([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const fail = (message: string) => {
    setPending(null);
    setHint(message);
    onError?.(message);
  };

  /** Яндекс и VK: получаем ссылку на согласие и уходим на неё целиком. */
  const startOauth = async (provider: string) => {
    setHint(null);
    setPending(provider);
    try {
      const started = await authApi.oauthStart(provider, returnTo ?? undefined);
      window.location.href = started.url;
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : "Не удалось начать вход");
    }
  };

  /**
   * Мессенджеры: показываем диплинк на бота и ждём подтверждения.
   * Человек подтверждает вход в Telegram или Max — вкладка сама продолжит вход.
   */
  const startBot = async (provider: string) => {
    setHint(null);
    setPending(provider);
    try {
      const started = await authApi.botStart(provider, {
        returnTo: returnTo ?? undefined,
        role: role === "admin" ? "client" : role,
      });

      if (!started.deepLink || !started.configuredBot) {
        // Бот ещё не создан: честно говорим об этом и оставляем запасной вход.
        fail(
          "Бот площадки ещё не подключён. Войдите через Яндекс ID или VK ID — или кодом по телефону (стенд).",
        );
        return;
      }

      setHint(`Открыли ${provider === "telegram" ? "Telegram" : "Max"}. Подтвердите вход у бота — эта страница обновится сама.`);
      window.open(started.deepLink, "_blank", "noopener");

      const result = await waitForBotLogin(provider, started.token);
      if (result.status === "confirmed") {
        // Сессию кладём в то же хранилище, что и остальные входы, и
        // перезагружаем страницу: AuthProvider подхватит её при старте.
        window.localStorage.setItem("nailgo_pending_session", JSON.stringify(result));
        window.location.assign(returnTo ?? "/");
      }
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : "Не удалось войти через мессенджер");
    }
  };

  const providerOrder: Record<string, number> = { vk: 0, yandex: 1, telegram: 2, max: 3 };
  const visible = providers
    .filter((item) => item.kind === "oauth" || item.kind === "messenger")
    .slice()
    .sort((left, right) => (providerOrder[left.provider] ?? 9) - (providerOrder[right.provider] ?? 9));
  if (visible.length === 0) return null;

  return (
    <div className="mt-5 space-y-3" data-block="quick-login">
      <div className="flex items-center text-xs uppercase tracking-[0.18em] text-slate-400">
        <span className="mr-3 h-px flex-1 bg-[#f0e4e0]" />
        <span className="mr-3">Быстрый вход</span>
        <span className="h-px flex-1 bg-[#f0e4e0]" />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((item) => {
          const unavailable = item.kind === "oauth" && !item.available;
          const iconTone = item.provider === "vk"
            ? "bg-[#3392ff] text-white"
            : item.provider === "yandex"
              ? "bg-[#fff0eb] text-[#f23f24]"
              : item.provider === "telegram"
                ? "bg-white text-[#229ed9]"
                : "bg-white text-[#8e3b9c]";
          return (
            <button
              key={item.provider}
              type="button"
              disabled={unavailable || pending === item.provider}
              onClick={() => (item.kind === "oauth" ? startOauth(item.provider) : startBot(item.provider))}
              data-provider={item.provider}
              title={unavailable ? `${item.title}: не настроены ключи приложения` : undefined}
              className={`flex items-center justify-center rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                STYLES[item.provider] ?? "border-[#e9dfdc] bg-white text-slate-700 hover:border-[#E58E82]"
              }`}
            >
              <span className={`mr-2 grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${iconTone}`}>
                {ICONS[item.provider] ?? item.title.slice(0, 2)}
              </span>
              {pending === item.provider ? "Открываем…" : item.title}
            </button>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-slate-400">
        SMS не отправляем: вход бесплатный, а напоминания приходят в Telegram или Max.
      </p>
      {hint && <p className="rounded-xl bg-[#fff7f5] px-3 py-2 text-xs text-slate-600">{hint}</p>}
    </div>
  );
}
