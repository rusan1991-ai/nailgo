import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) return `+7${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 11) return `+${digits}`;
  return value;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, user } = useAuth();

  const params = new URLSearchParams(location.search);
  const returnTo = params.get("returnTo") || "/";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      navigate(returnTo, { replace: true });
    }
  }, [navigate, returnTo, user]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedPhone = normalizePhone(phone.trim());
    if (!name.trim()) {
      setError("Введите имя");
      return;
    }

    if (!/^\+7\d{10}$/.test(normalizedPhone)) {
      setError("Введите телефон в формате +79991234567");
      return;
    }

    signIn({ name: name.trim(), phone: normalizedPhone });
    navigate(returnTo, { replace: true });
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#fff7fa] p-4">
      <section className="w-full max-w-[520px] rounded-3xl border border-[#f6dce7] bg-white p-7 shadow-[0_26px_70px_-45px_rgba(236,72,153,0.65)]">
        <p className="text-sm uppercase tracking-[0.22em] text-pink-500">NailGo</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900">Вход и регистрация</h1>
        <p className="mt-2 text-slate-500">Чтобы записаться к мастеру, войдите в аккаунт.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
            placeholder="Ваше имя"
          />
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
            placeholder="Телефон +79991234567"
          />

          {error && <p className="text-sm text-rose-500">{error}</p>}

          <button className="w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600">
            Продолжить
          </button>
        </form>

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