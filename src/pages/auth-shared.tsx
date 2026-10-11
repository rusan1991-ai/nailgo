/**
 * Общие части экранов входа и регистрации.
 *
 * Вход и регистрация — разные экраны (это разные действия), но поля, выбор роли
 * и работа с кодом у них одни. Общий код здесь, чтобы формы не разъезжались.
 */
import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { homePath, useAuth, type LoginRole } from "../auth/AuthContext";

export type RoleCard = { value: LoginRole; title: string; hint: string };

export const CLIENT_CARD: RoleCard = {
  value: "client",
  title: "Я клиент",
  hint: "Запись к мастерам, история визитов, отзывы",
};

export const MASTER_CARD: RoleCard = {
  value: "master",
  title: "Я мастер",
  hint: "Кабинет: записи, расписание, услуги, отзывы",
};

/** Выбор «куда вхожу» / «кем регистрируюсь»: клиент или мастер. */
export function RoleChoice({
  role,
  onChange,
  legend,
  cards = [CLIENT_CARD, MASTER_CARD],
}: {
  role: LoginRole;
  onChange: (next: LoginRole) => void;
  legend: string;
  cards?: RoleCard[];
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {cards.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            data-role={option.value}
            aria-pressed={role === option.value}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              role === option.value ? "border-pink-400 bg-[#fff4f8]" : "border-[#f1dde6] hover:border-pink-200"
            }`}
          >
            <span className="block text-sm font-semibold text-slate-800">{option.title}</span>
            <span className="mt-1 block text-xs text-slate-500">{option.hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Каркас карточки: заголовок, подпись, содержимое и футер со ссылками. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#fff7fa] p-4">
      <section className="w-full max-w-[520px] rounded-3xl border border-[#f6dce7] bg-white p-7 shadow-[0_26px_70px_-45px_rgba(236,72,153,0.65)]">
        <p className="text-sm uppercase tracking-[0.22em] text-pink-500">Nail 2 Go</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-slate-500">{subtitle}</p>
        {children}
        {footer && <div className="mt-5 border-t border-[#f3e4ea] pt-4 text-sm text-slate-500">{footer}</div>}
      </section>
    </main>
  );
}

type CodeForm = {
  code: string;
  setCode: (value: string) => void;
  devCode: string | null;
  hint: string;
  error: string;
  pending: boolean;
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  back: () => void;
};

/** Шаг с кодом: подстановка демо-кода, ошибки и кнопки «Войти/Создать аккаунт». */
export function CodeStep({
  code,
  setCode,
  devCode,
  hint,
  error,
  pending,
  submit,
  back,
  submitLabel,
}: CodeForm & { submitLabel: string }) {
  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <input
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        data-field="code"
        className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-center text-lg tracking-[0.5em] outline-none transition focus:border-pink-300"
        placeholder="0000"
      />
      {devCode && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Демо-режим: код {devCode} подставлен автоматически, SMS не отправлялись.
        </p>
      )}
      {hint && !devCode && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <button
        disabled={pending}
        data-action="submit-code"
        className="w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
      >
        {pending ? "Проверяем..." : submitLabel}
      </button>
      <button
        type="button"
        onClick={back}
        className="w-full text-sm text-slate-500 hover:text-pink-600"
      >
        Изменить номер
      </button>
    </form>
  );
}

/**
 * Логика экрана авторизации.
 *
 * `mode` решает, что делает сервер: `login` — вход в существующий аккаунт,
 * `register` — создание. Возврат после успеха — `returnTo` либо кабинет по роли.
 */
export function useAuthScreen(mode: "login" | "register", initialRole: LoginRole = "client") {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestCode, verifyCode, user, pending, error: authError } = useAuth();

  const params = new URLSearchParams(location.search);
  const returnTo = params.get("returnTo") || null;

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [role, setRole] = useState<LoginRole>(initialRole);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [devLogin, setDevLogin] = useState(false);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");

  /** Куда вести после входа: явный returnTo либо свой кабинет по роли. */
  const destination = returnTo ?? homePath(user);

  useEffect(() => {
    if (user) navigate(destination, { replace: true });
  }, [destination, navigate, user]);

  const requestCodeStep = async (forDevLogin: boolean) => {
    setError("");
    setDevCode(null);
    setHint("");
    setCode("");
    setDevLogin(forDevLogin && mode === "login");

    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Введите телефон в формате +79991234567");
      return;
    }
    if (mode === "register" && name.trim().length < 2) {
      setError("Укажите имя — так вас увидят мастера");
      return;
    }

    try {
      const response = await requestCode(phone);
      setDevCode(response.devCode ?? null);
      setHint(response.message);
      setCode(response.devCode ?? "");
      setStep("code");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отправить код");
    }
  };

  const askCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await requestCodeStep(false);
  };

  const askDevCode = async () => {
    if (mode !== "login") return;
    await requestCodeStep(true);
  };

  const confirmCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(code.trim())) {
      setError("Код состоит из 4 цифр");
      return;
    }
    try {
      const loggedIn = await verifyCode({
        phone,
        code: code.trim(),
        name: name.trim() || undefined,
        role,
        mode: devLogin && mode === "login" ? "dev_login" : mode,
      });
      navigate(returnTo ?? homePath(loggedIn), { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти");
    }
  };

  return {
    step,
    role,
    setRole,
    setError,
    name,
    setName,
    phone,
    setPhone,
    code,
    setCode,
    devCode,
    hint,
    error: error || authError || "",
    pending,
    askCode,
    askDevCode,
    /** Шаг кода отправляет та же форма: `submit` — обработчик подтверждения. */
    submit: confirmCode,
    back: () => {
      setStep("phone");
      setCode("");
      setDevLogin(false);
      setError("");
    },
    returnTo,
  };
}
