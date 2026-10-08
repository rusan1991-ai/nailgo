/**
 * Вход. Только вход: сначала выбираем, куда входим — клиент или мастер, —
 * затем телефон и код. Регистрация живёт на отдельном экране `/register`:
 * это разные действия, и путать их нельзя (вход по новому номеру больше
 * не создаёт аккаунт молча).
 */
import { Link } from "react-router-dom";
import { AuthCard, CodeStep, RoleChoice, useAuthScreen } from "./auth-shared";
import { QuickLogin } from "../components/QuickLogin";

export function LoginPage() {
  const screen = useAuthScreen("login");

  return (
    <AuthCard
      title="Вход"
      subtitle={
        screen.step === "phone"
          ? "Войдите в один клик — или, на стенде, по коду из журнала сервера."
          : `Код отправлен на ${screen.phone}. Он действует 5 минут. ${
              screen.role === "master" ? "Входите как мастер." : "Входите как клиент."
            }`
      }
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
            Стенд без SMS: код подтверждения пишется в журнал сервера и подставляется в форму автоматически.
            Демо-доступы: мастер — <span className="font-medium text-slate-700">+7 999 000-00-01</span>,
            клиент — любой зарегистрированный номер.
          </p>
          <Link to="/" className="mt-2 inline-block text-pink-600 hover:text-pink-700">
            Вернуться на главную
          </Link>
        </>
      }
    >
      {screen.step === "phone" ? (
        <>
        <QuickLogin role={screen.role} returnTo={screen.returnTo} onError={screen.setError} />
        <form onSubmit={screen.askCode} className="mt-6 space-y-3">
          <RoleChoice
            role={screen.role}
            onChange={screen.setRole}
            legend="Куда входите?"
          />
          <input
            value={screen.phone}
            onChange={(event) => screen.setPhone(event.target.value)}
            inputMode="tel"
            data-field="phone"
            className="w-full rounded-xl border border-[#f1dde6] px-4 py-3 text-sm outline-none transition focus:border-pink-300"
            placeholder="Телефон +79991234567"
          />
          {screen.error && <p className="text-sm text-rose-500">{screen.error}</p>}
          <button
            disabled={screen.pending}
            data-action="ask-code"
            className="w-full rounded-xl bg-pink-500 py-3 text-sm font-semibold text-white transition hover:bg-pink-600 disabled:opacity-60"
          >
            {screen.pending ? "Отправляем код..." : "Получить код"}
          </button>
        </form>
        </>
      ) : (
        <CodeStep {...screen} submitLabel="Войти" />
      )}
    </AuthCard>
  );
}
