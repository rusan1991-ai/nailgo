import { useEffect, useRef, useState } from "react";
import { Flower2, Heart, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, type AuthUser } from "../auth/AuthContext";
import { api } from "../api/client";

const BRAND = "Nail 2 Go";

const AUTH_PATH = "/auth/magic/verify";

type MagicAuthResponse = {
  ok: true;
  bookingId: string | null;
  redirect: string;
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

type MagicError = Error & { code?: string };

/**
 * Красивый промежуточный экран одноразового входа.
 *
 * Показывается, пока API проверяет magic-link и выдаёт сессию. Токен
 * отправляется только POST-запросом (не утечёт в Referer и access-логи); после
 * успеха сессия сохраняется через AuthProvider и открывается запись, ради
 * которой мастер прислал ссылку.
 */
export function MagicLoginPage({ magic }: { magic: string }) {
  const navigate = useNavigate();
  const { acceptSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const requestRef = useRef<Promise<MagicAuthResponse> | null>(null);

  useEffect(() => {
    let alive = true;

    // Убираем секрет из адресной строки и истории прямо перед сетевым запросом:
    // после этого magic-токен не попадёт в Referer у API-запросов и аналитики.
    if (window.location.search.includes("magic=")) {
      window.history.replaceState(null, document.title, "/login");
    }

    // StrictMode повторно исполняет эффекты в dev. Одноразовую ссылку нельзя
    // использовать два раза, поэтому один POST разделяется между обоими
    // проходами эффекта.
    requestRef.current ??= Promise.all([
      api.post<MagicAuthResponse>(AUTH_PATH, { magic }),
      new Promise<void>((resolve) => window.setTimeout(resolve, 420)),
    ]).then(([response]) => response);

    void requestRef.current
      .then((response) => {
        if (!alive) return;
        acceptSession(response);
        setLeaving(true);
        // Короткий fade-out делает переход ощущением продолжения, а не рывком.
        window.setTimeout(() => navigate(response.redirect || "/cabinet", { replace: true }), 300);
      })
      .catch((caught: MagicError) => {
        if (!alive) return;
        setError(caught.message || "Ссылка не сработала. Попросите мастера прислать новую.");
      });

    return () => {
      alive = false;
    };
  }, [acceptSession, magic, navigate]);

  return (
    <main
      className="n2g-magic-root relative grid n2g-min-h-viewport overflow-hidden place-items-center bg-[#fff1f6] px-6 text-center"
      data-page="magic-login"
      data-state={error ? "error" : leaving ? "redirecting" : "loading"}
    >
      <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-[#ffebf1] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -right-14 h-80 w-80 rounded-full bg-[#fbe4ed] blur-3xl" />

      <div className="relative z-10 w-full max-w-md rounded-[2rem] border border-white/80 bg-white/65 px-7 py-10 shadow-[0_24px_80px_rgba(157,84,112,0.12)] backdrop-blur-xl">
        <div className="mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-[#f7dce7] bg-white/80 px-4 py-2 text-sm font-semibold tracking-wide text-[#a44468]">
          <Heart className="h-4 w-4 fill-[#ec91b4] text-[#ec91b4]" aria-hidden="true" />
          {BRAND}
        </div>

        {!error ? (
          <>
            <div className="relative mx-auto grid h-28 w-28 place-items-center" aria-hidden="true">
              <span className="absolute inset-0 rounded-full border border-[#f3b7cb]/50" />
              <span className="absolute inset-2 rounded-full bg-[#fde1eb] shadow-inner" />
              <span className="n2g-loader-icon relative grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#fff8fb] to-[#f7d2e0] text-[#bd658a] shadow-[0_8px_30px_rgba(195,104,142,0.2)]">
                <Flower2 className="h-11 w-11" strokeWidth={1.65} />
                <Sparkles className="absolute -right-1 top-1 h-5 w-5 text-[#d58aa7]" />
              </span>
            </div>
            <h1 className="n2g-loader-text mt-8 text-lg font-medium leading-8 text-[#49434a]" aria-live="polite">
              Секунду, Nail 2 Go открывает ваш личный кабинет... 💕
            </h1>
            <div className="mx-auto mt-6 h-1 w-32 overflow-hidden rounded-full bg-[#f6dce6]" aria-hidden="true">
              <span className="n2g-loader-progress block h-full w-1/2 rounded-full bg-[#c87596]" />
            </div>
            <p className="mt-5 text-xs text-[#8c7c85]">Проверяем вашу персональную ссылку — пароли не нужны.</p>
          </>
        ) : (
          <>
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#fff0f5] text-[#bd658a]">
              <Heart className="h-9 w-9" />
            </div>
            <h1 className="mt-6 text-xl font-semibold text-[#49434a]">Ссылка не открылась</h1>
            <p className="mt-3 text-sm leading-6 text-[#776b73]" data-field="magic-error">
              {error}
            </p>
            <p className="mt-3 text-xs leading-5 text-[#988b92]">
              Возможно, ей уже воспользовались или срок действия закончился.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                to="/login"
                replace
                data-action="magic-back-to-login"
                className="rounded-xl bg-[#c87596] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#b46585]"
              >
                Вернуться ко входу
              </Link>
              <Link
                to="/"
                className="rounded-xl border border-[#efd8e1] bg-white/70 px-5 py-3 text-sm font-medium text-[#7c6270] transition hover:bg-white"
              >
                На главную
              </Link>
            </div>
          </>
        )}
      </div>

      <p className="absolute bottom-5 text-[11px] tracking-wide text-[#a2919a]">Личный кабинет • {BRAND}</p>
    </main>
  );
}
