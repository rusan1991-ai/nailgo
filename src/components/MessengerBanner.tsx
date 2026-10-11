/**
 * Плашка «Привяжите Telegram или Max».
 *
 * SMS площадка не покупает, поэтому без привязанного мессенджера напоминание
 * о визите уходит только в журнал системы — человек его не увидит. Плашка
 * заметная и живёт в обоих кабинетах: у клиента и у мастера.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { messengersApi, waitForMessengerLink, type MessengerState } from "../api/messengers";

export type MessengerBannerProps = {
  /** Куда ведёт ссылка «настроить»: у кабинетов свои страницы настроек. */
  settingsTo: string;
  className?: string;
};

export function useMessengerState() {
  const [state, setState] = useState<MessengerState | null>(null);

  const reload = useCallback(() => {
    void messengersApi
      .state()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(reload, [reload]);
  return { state, reload };
}

export function MessengerBanner({ settingsTo, className = "" }: MessengerBannerProps) {
  const { state } = useMessengerState();

  // Пока состояние неизвестно или канал уже привязан — плашку не показываем.
  if (!state?.needsLink) return null;

  return (
    <div
      data-block="messenger-banner"
      className={`flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg" aria-hidden>
        🔔
      </span>
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Привяжите Telegram или Max</span>, чтобы бесплатно получать напоминания о записях.
        SMS не отправляем — без мессенджера напоминание останется только в журнале.
      </p>
      <Link
        to={settingsTo}
        data-action="link-messenger"
        className="rounded-xl bg-amber-500 px-4 py-2 font-medium text-white transition hover:bg-amber-600"
      >
        Привязать
      </Link>
    </div>
  );
}

/**
 * Карточка «Способы входа»: привязки, привязка мессенджеров и телефон.
 * Телефон здесь — просто контакт: его можно стереть, вход от этого не сломается.
 */
export function LoginMethodsCard() {
  const { state, reload } = useMessengerState();
  const [pending, setPending] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const link = async (provider: "telegram" | "max") => {
    setError(null);
    setHint(null);
    setPending(provider);
    try {
      const started = await messengersApi.link(provider);
      if (started.alreadyLinked) {
        setHint("Канал уже привязан");
        reload();
        return;
      }
      if (!started.deepLink || !started.botConfigured || !started.token) {
        setError("Бот площадки ещё не подключён — привязка появится, когда его настроят.");
        return;
      }

      setHint(`Открыли ${provider === "telegram" ? "Telegram" : "Max"}: отправьте боту /start — привязка подтвердится сама.`);
      window.open(started.deepLink, "_blank", "noopener");
      const linked = await waitForMessengerLink(provider, started.token);
      if (linked) {
        setHint("Готово: напоминания будут приходить в мессенджер");
        reload();
      } else {
        setError("Бот не подтвердил привязку. Попробуйте ещё раз.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось привязать мессенджер");
    } finally {
      setPending(null);
    }
  };

  const unlink = async (provider: "telegram" | "max") => {
    setError(null);
    setPending(provider);
    try {
      await messengersApi.unlink(provider);
      setHint("Привязка снята: напоминания снова идут в журнал");
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось снять привязку");
    } finally {
      setPending(null);
    }
  };

  if (!state) return null;

  const rows: { key: "telegram" | "max"; title: string; linked: boolean; bot: boolean }[] = [
    { key: "telegram", title: "Telegram", linked: state.telegram.linked, bot: state.telegram.botConfigured },
    { key: "max", title: "Max", linked: state.max.linked, bot: state.max.botConfigured },
  ];

  return (
    <article className="rounded-2xl border border-[#f1dde6] p-4" data-block="login-methods">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Способы входа</p>
        <span className="rounded-lg bg-[#fff4f8] px-2 py-1 text-xs text-slate-500">
          Уведомления: {state.channelLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Вход по SMS мы отключили — пароль не нужен. Подтверждается всё в мессенджере, там же приходят напоминания.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#f6e7ed] px-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-800">{row.title}</p>
              <p className="text-xs text-slate-500">
                {row.linked ? "привязан" : row.bot ? "бот готов, привязка не сделана" : "бот ещё не подключён площадкой"}
              </p>
            </div>
            <button
              type="button"
              disabled={pending === row.key || (!row.linked && !row.bot)}
              data-action={row.linked ? `unlink-${row.key}` : `link-${row.key}`}
              onClick={() => (row.linked ? unlink(row.key) : link(row.key))}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                row.linked
                  ? "border border-[#f1dde6] text-slate-600 hover:border-rose-200 hover:text-rose-600"
                  : "bg-pink-500 text-white hover:bg-pink-600"
              }`}
            >
              {pending === row.key ? "…" : row.linked ? "Отвязать" : "Привязать"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-sm font-medium text-slate-700">Привязанные аккаунты</p>
        {(state.identities ?? []).length === 0 && <p className="text-sm text-slate-500">Пока ничего не привязано.</p>}
        {(state.identities ?? []).map((identity) => (
          <div key={identity.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">
              {identity.provider}
              {identity.username ? ` · @${identity.username}` : ""}
            </span>
          </div>
        ))}
      </div>

      {hint && <p className="mt-3 rounded-xl bg-[#f0fdf4] px-3 py-2 text-sm text-emerald-700">{hint}</p>}
      {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
    </article>
  );
}
