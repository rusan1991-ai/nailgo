/**
 * Вход администратора-модератора: отдельная форма, только вход.
 *
 * Эта страница нигде на сайте не выводится — на неё не ведут ни меню,
 * ни кнопки: админ открывает адрес `/admin/login` сам. Регистрации здесь нет
 * (и на сервере она запрещена), выбора роли тоже: форма всегда проверяет,
 * что номер принадлежит администратору. Чужой номер получит отказ.
 */
import { Link } from "react-router-dom";
import { AuthCard, CodeStep, useAuthScreen } from "./auth-shared";

export function AdminLoginPage() {
  const screen = useAuthScreen("login", "admin");

  return (
    <AuthCard
      title="Вход для администратора"
      subtitle={
        screen.step === "phone"
          ? "Модерация отзывов. Доступ только у администратора NailGo."
          : `Код отправлен на ${screen.phone}. Он действует 5 минут.`
      }
      footer={
        <p className="text-xs text-slate-400">
          Регистрации в админке нет: доступ выдаёт владелец сервиса.{" "}
          <Link to="/login" className="text-slate-500 hover:text-pink-600">
            Обычный вход
          </Link>
        </p>
      }
    >
      {screen.step === "phone" ? (
        <form onSubmit={screen.askCode} className="mt-6 space-y-3">
          <input
            value={screen.phone}
            onChange={(event) => screen.setPhone(event.target.value)}
            inputMode="tel"
            data-field="phone"
            className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
            placeholder="Телефон администратора"
          />
          {screen.error && <p className="text-sm text-rose-500">{screen.error}</p>}
          <button
            disabled={screen.pending}
            data-action="ask-code"
            className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {screen.pending ? "Отправляем код..." : "Получить код"}
          </button>
        </form>
      ) : (
        <CodeStep {...screen} submitLabel="Войти в админку" />
      )}
    </AuthCard>
  );
}
