import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestCode, verifyCode, user, pending, error: authError } = useAuth();

  const params = new URLSearchParams(location.search);
  const returnTo = params.get("returnTo") || "/";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      navigate(returnTo, { replace: true });
    }
  }, [navigate, returnTo, user]);

  const askCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Введите телефон в формате +79991234567");
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

  const confirmCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(code.trim())) {
      setError("Код состоит из 4 цифр");
      return;
    }
    try {
      await verifyCode({ phone, code: code.trim(), name: name.trim() || undefined });
      navigate(returnTo, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти");
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#fff7fa] p-4">
      <section className="w-full max-w-[520px] rounded-3xl border border-[#f6dce7] bg-white p-7 shadow-[0_26px_70px_-45px_rgba(236,72,153,0.65)]">
        <p className="text-sm uppercase tracking-[0.22em] text-pink-500">NailGo</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900">Вход и регистрация</h1>
        <p className="mt-2 text-slate-500">
          {step === "phone"
            ? "Введите телефон — отправим код подтверждения."
            : `Код отправлен на ${phone}. Он действует 5 минут.`}
        </p>

        {step === "phone" ? (
          <form onSubmit={askCode} className="mt-6 space-y-3">
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
              placeholder="Телефон +79991234567"
            />
            {(error || authError) && <p className="text-sm text-rose-500">{error || authError}</p>}
            <button
              disabled={pending}
              className="w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
            >
              {pending ? "Отправляем код..." : "Получить код"}
            </button>
          </form>
        ) : (
          <form onSubmit={confirmCode} className="mt-6 space-y-3">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-center text-lg tracking-[0.5em] outline-none transition focus:border-pink-300"
              placeholder="0000"
            />
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
              placeholder="Как вас зовут (необязательно)"
            />
            {devCode && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Демо-режим: код {devCode} подставлен автоматически, SMS не отправлялись.
              </p>
            )}
            {hint && !devCode && <p className="text-xs text-slate-500">{hint}</p>}
            {(error || authError) && <p className="text-sm text-rose-500">{error || authError}</p>}
            <button
              disabled={pending}
              className="w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
            >
              {pending ? "Проверяем..." : "Войти"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setCode("");
                setError("");
              }}
              className="w-full text-sm text-slate-500 hover:text-pink-600"
            >
              Изменить номер
            </button>
          </form>
        )}

        <div className="mt-5 border-t border-[#f3e4ea] pt-4 text-sm text-slate-500">
          <p>После входа вы сможете записываться, отменять и смотреть историю своих записей.</p>
          <Link to="/" className="mt-2 inline-block text-pink-600 hover:text-pink-700">
            Вернуться на главную
          </Link>
        </div>
      </section>
    </main>
  );
}
