/**
 * Вход в клиентский/мастерский кабинет: код со стенда или бесплатная выдача
 * четырёхзначного OTP через Telegram-бота после проверки Telegram ID.
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { normalizePhone } from "../auth/AuthContext";
import { MagicLoginPage } from "./MagicLoginPage";
import { AuthCard, CodeStep, RoleChoice, useAuthScreen } from "./auth-shared";
import { QuickLogin } from "../components/QuickLogin";

type TelegramOtpFlow = {
  token: string;
  deepLink: string;
  expiresAt: string;
  expiresInSeconds: number;
  message: string;
};

type TelegramOtpStatus = { status: "pending" | "sent" | "failed"; message?: string };

export function LoginPage() {
  const [params] = useSearchParams();
  const magic = params.get("magic");
  if (magic) return <MagicLoginPage key={magic} magic={magic} />;
  return <LoginForm />;
}

function LoginForm() {
  const screen = useAuthScreen("login");
  const [telegramFlow, setTelegramFlow] = useState<TelegramOtpFlow | null>(null);
  const [telegramStatus, setTelegramStatus] = useState("");
  const [telegramError, setTelegramError] = useState("");
  const [telegramPending, setTelegramPending] = useState(false);

  useEffect(() => {
    if (!telegramFlow?.token) return;
    let alive = true;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const response = await api.get<TelegramOtpStatus>(
          `/auth/telegram-otp/status?token=${encodeURIComponent(telegramFlow.token)}`,
        );
        if (!alive) return;
        if (response.status === "sent") {
          setTelegramStatus("Код отправлен ботом. Введите четыре цифры ниже.");
          setTelegramError("");
          return;
        }
        if (response.status === "failed") {
          setTelegramError(response.message ?? "Не удалось подтвердить Telegram.");
          setTelegramStatus("");
          return;
        }
        timer = window.setTimeout(() => void poll(), 1500);
      } catch (caught) {
        if (!alive) return;
        if (caught instanceof ApiError && (caught.status === 404 || caught.status === 410)) {
          setTelegramError("Ссылка истекла. Запросите новый код в Telegram.");
          setTelegramStatus("");
          return;
        }
        timer = window.setTimeout(() => void poll(), 2500);
      }
    };

    void poll();
    return () => {
      alive = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [telegramFlow?.token]);

  const requestTelegramCode = async () => {
    setTelegramError("");
    setTelegramStatus("");
    const digits = screen.phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setTelegramError("Введите телефон в формате +79991234567");
      return;
    }

    setTelegramPending(true);
    try {
      const flow = await api.post<TelegramOtpFlow>("/auth/request-telegram-otp", {
        phone: normalizePhone(screen.phone),
      });
      setTelegramFlow(flow);
      setTelegramStatus("Откройте бота по ссылке и нажмите Start — он проверит ваш Telegram ID.");
      screen.setCode("");
    } catch (caught) {
      setTelegramError(caught instanceof Error ? caught.message : "Не удалось запросить код в Telegram");
    } finally {
      setTelegramPending(false);
    }
  };

  const backFromCode = () => {
    setTelegramFlow(null);
    setTelegramStatus("");
    setTelegramError("");
    screen.back();
  };

  const codeSubtitle = telegramFlow
    ? `Код для ${screen.phone} действует 5 минут. Бот отправит его после проверки привязанного Telegram.`
    : `Код отправлен на ${screen.phone}. Он действует 5 минут. ${
        screen.role === "master" ? "Входите как мастер." : "Входите как клиент."
      }`;

  return (
    <AuthCard
      title="Вход"
      subtitle={screen.step === "phone" && !telegramFlow
        ? "Введите номер и получите бесплатный код через Telegram-бота."
        : codeSubtitle}
      footer={
        <>
          <p className="flex flex-wrap items-center gap-2">
            Ещё нет аккаунта?
            <Link
              to={`/register${screen.returnTo ? `?returnTo=${encodeURIComponent(screen.returnTo)}` : ""}`}
              data-action="go-register"
              className="rounded-xl border border-[#f1dde6] px-3 py-1.5 font-medium text-pink-600 hover:border-pink-300"
            >
              Зарегистрироваться
            </Link>
          </p>
          <p className="mt-3 rounded-xl bg-[#fff4f8] px-3 py-2 text-xs text-slate-500">
            Платные SMS не используются. В production четырёхзначный код выдаёт Telegram-бот после проверки привязанного Telegram ID;
            на стенде код тестового входа может появиться в ответе формы.
          </p>
          <Link to="/" className="mt-2 inline-block text-pink-600 hover:text-pink-700">
            Вернуться на главную
          </Link>
        </>
      }
    >
      {screen.step === "phone" && !telegramFlow ? (
        <>
          <QuickLogin role={screen.role} returnTo={screen.returnTo} onError={screen.setError} />
          <form onSubmit={screen.askCode} className="mt-6 space-y-3">
            <RoleChoice role={screen.role} onChange={screen.setRole} legend="Куда входите?" />
            <input
              value={screen.phone}
              onChange={(event) => {
                screen.setPhone(event.target.value);
                setTelegramError("");
              }}
              inputMode="tel"
              data-field="phone"
              className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
              placeholder="Телефон +79991234567"
            />
            {(screen.error || telegramError) && <p className="text-sm text-rose-500">{telegramError || screen.error}</p>}
            <button
              type="button"
              onClick={() => void requestTelegramCode()}
              disabled={telegramPending || screen.pending}
              data-action="request-telegram-code"
              className="w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
            >
              {telegramPending ? "Создаём ссылку…" : "Получить код в Telegram"}
            </button>
            {import.meta.env.DEV && (
              <button
                disabled={screen.pending}
                data-action="ask-code"
                className="w-full rounded-xl border border-[#f1dde6] py-2.5 text-sm font-medium text-slate-600 transition hover:border-pink-300 disabled:opacity-60"
              >
                {screen.pending ? "Запрашиваем…" : "Получить код (тестовый режим)"}
              </button>
            )}
          </form>
        </>
      ) : (
        <>
          {telegramFlow && (
            <div className="mt-5 rounded-2xl border border-[#f1dde6] bg-[#fff8fb] p-4" data-block="telegram-otp">
              <a
                href={telegramFlow.deepLink}
                target="_blank"
                rel="noreferrer"
                data-action="open-telegram-bot"
                className="inline-flex rounded-xl bg-[#229ed9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#168ac0]"
              >
                Открыть бота в Telegram
              </a>
              <p className="mt-2 text-xs text-slate-500" data-field="telegram-otp-status">
                {telegramError || telegramStatus || telegramFlow.message}
              </p>
            </div>
          )}
          <CodeStep
            code={screen.code}
            setCode={screen.setCode}
            devCode={telegramFlow ? null : screen.devCode}
            hint={telegramFlow ? "Введите код из сообщения бота. Код действует 5 минут." : screen.hint}
            error={screen.error || telegramError}
            pending={screen.pending || telegramPending}
            submit={screen.submit}
            back={backFromCode}
            submitLabel="Войти"
          />
        </>
      )}
    </AuthCard>
  );
}
