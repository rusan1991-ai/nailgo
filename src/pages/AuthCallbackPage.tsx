/**
 * Возврат от провайдера входа (Яндекс ID, VK ID).
 *
 * Токены провайдер отправляет через фрагмент ссылки — он не попадает в логи
 * сервера и в заголовок Referer. Здесь мы забираем их, складываем в то же
 * хранилище, что и обычный вход, и уходим в кабинет. Если провайдер вернул
 * ошибку, показываем её человеческим языком и предлагаем запасные способы.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { homePath, type AuthUser } from "../auth/AuthContext";
import { safeStorage } from "../utils/storage";

const SESSION_KEY = "nailgo_auth_user";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    const failure = query.get("error") ?? fragment.get("error");
    if (failure) {
      setError(failure);
      return;
    }

    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    const provider = fragment.get("provider") ?? "провайдер";
    const to = fragment.get("to");

    if (!accessToken || !refreshToken) {
      setError("Провайдер не вернул данные входа. Попробуйте ещё раз.");
      return;
    }

    /**
     * Пользователя доберём через /auth/me при старте AuthProvider: хранить
     * профиль в ссылке не нужно, а сессия и так только что выдана сервером.
     */
    const stub: AuthUser = { id: "", name: "", phone: null, role: "client", masterSlug: null };
    safeStorage.set(SESSION_KEY, JSON.stringify({ user: stub, accessToken, refreshToken }));

    // Полная перезагрузка: AuthProvider поднимет сессию и подтянет профиль.
    void provider;
    window.location.replace(to && to.startsWith("/") ? to : homePath(null));
  }, [navigate]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#fff7fa] px-6 text-center">
      <div className="max-w-md">
        <p className="text-sm uppercase tracking-[0.2em] text-pink-500">Nail 2 Go</p>
        {error ? (
          <>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Войти не получилось</h1>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link to="/login" className="rounded-xl bg-pink-500 px-5 py-3 text-sm font-semibold text-white hover:bg-pink-600">
                Вернуться к входу
              </Link>
              <Link to="/" className="rounded-xl border border-pink-200 px-5 py-3 text-sm font-medium text-pink-600 hover:bg-pink-50">
                На главную
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">Входим…</h1>
            <p className="mt-2 text-sm text-slate-500">Проверяем ответ провайдера и открываем ваш кабинет.</p>
          </>
        )}
      </div>
    </main>
  );
}
