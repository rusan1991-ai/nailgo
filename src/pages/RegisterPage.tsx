/**
 * Регистрация. Сначала выбираем, кем регистрируемся — клиентом или мастером, —
 * затем имя и телефон. «Я мастер» сразу создаёт профиль мастера и открывает
 * кабинет; «я клиент» — личный кабинет.
 *
 * Если номер уже занят, сервер отвечает `already_registered`, и форма
 * предлагает перейти на вход, а не перезаписывает чужой аккаунт.
 */
import { Link, useNavigate } from "react-router-dom";
import { AuthCard, CodeStep, RoleChoice, useAuthScreen } from "./auth-shared";

export function RegisterPage() {
  const screen = useAuthScreen("register");
  const navigate = useNavigate();

  // Номер уже зарегистрирован — ведём на вход, сохраняя выбор роли.
  const alreadyRegistered = screen.error.includes("уже зарегистрирован");

  return (
    <AuthCard
      title="Регистрация"
      subtitle={
        screen.step === "phone"
          ? "Выберите, кем регистрируетесь, и введите имя с телефоном — отправим код."
          : `Код отправлен на ${screen.phone}. ${
              screen.role === "master" ? "Создаём кабинет мастера." : "Создаём кабинет клиента."
            }`
      }
      footer={
        <>
          <p className="flex flex-wrap items-center gap-2">
            Уже есть аккаунт?
            <Link
              to={`/login${screen.returnTo ? `?returnTo=${encodeURIComponent(screen.returnTo)}` : ""}`}
              data-action="go-login"
              className="rounded-xl border border-[#f1dde6] px-3 py-1.5 font-medium text-pink-600 hover:border-pink-300"
            >
              Войти
            </Link>
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Мастеру кабинет создаётся сразу: можно заполнить профиль, услуги и часы работы.
            Клиенту доступны запись, история визитов и отзывы.
          </p>
          <Link to="/" className="mt-2 inline-block text-pink-600 hover:text-pink-700">
            Вернуться на главную
          </Link>
        </>
      }
    >
      {screen.step === "phone" ? (
        <form onSubmit={screen.askCode} className="mt-6 space-y-3">
          <RoleChoice
            role={screen.role}
            onChange={screen.setRole}
            legend="Кем регистрируетесь?"
          />
          <input
            value={screen.name}
            onChange={(event) => screen.setName(event.target.value)}
            data-field="name"
            className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
            placeholder="Как вас зовут"
          />
          <input
            value={screen.phone}
            onChange={(event) => screen.setPhone(event.target.value)}
            inputMode="tel"
            data-field="phone"
            className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
            placeholder="Телефон +79991234567"
          />
          <p className="text-xs text-slate-400">
            {screen.role === "master"
              ? "После регистрации откроется кабинет мастера: услуги, расписание и записи."
              : "После регистрации откроется «Мой профиль»: записи, история визитов и отзывы."}
          </p>
          {screen.error && <p className="text-sm text-rose-500">{screen.error}</p>}
          {alreadyRegistered && (
            <button
              type="button"
              onClick={() => navigate(`/login${screen.returnTo ? `?returnTo=${encodeURIComponent(screen.returnTo)}` : ""}`)}
              className="w-full rounded-xl border border-pink-200 py-3 text-sm font-medium text-pink-600 hover:bg-pink-50"
            >
              Перейти ко входу
            </button>
          )}
          <button
            disabled={screen.pending}
            data-action="ask-code"
            className="w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
          >
            {screen.pending ? "Отправляем код..." : "Получить код"}
          </button>
        </form>
      ) : (
        <CodeStep {...screen} submitLabel="Создать аккаунт" />
      )}
    </AuthCard>
  );
}
