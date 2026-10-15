/**
 * Короткая ссылка мастера: `nail2go.ru/any_nails` и `nail2go.ru/masters/any_nails`.
 *
 * Адрес разрешается на сервере (`GET /masters/<username>` понимает и короткую
 * ссылку, и обычный slug): если мастер найден — показываем его витрину, причём
 * красивый адрес остаётся в строке браузера, чтобы ссылку можно было диктовать
 * и отправлять дальше. Неизвестная ссылка — честная страница «мастер не найден»
 * со ссылкой на поиск, а не пустой экран и не чужой профиль.
 */
import { Link, useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useApiResource } from "../api/resource";
import { MasterPage } from "./MasterPage";

type ShortLinkCard = { slug: string; name: string; usernameSlug: string | null };

export function ShortLinkPage() {
  const { username } = useParams();
  const { data, loading } = useApiResource<ShortLinkCard>(
    username ? `/masters/${encodeURIComponent(username)}` : null,
  );

  if (loading) {
    return (
      <main className="grid n2g-min-h-viewport place-items-center bg-[#fff7fa] p-6 text-center text-slate-500">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-pink-500">Nail 2 Go</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">Открываем витрину мастера…</h1>
        </div>
      </main>
    );
  }

  if (!data?.slug) {
    return (
      <main className="n2g-min-h-viewport bg-[#fff7fa] p-4 sm:p-8">
        <div className="mx-auto max-w-[1280px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
          <AppHeader />
          <div data-block="short-link-missing" className="mt-16 text-center">
            <p className="text-sm uppercase tracking-[0.2em] text-pink-500">Nail 2 Go</p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-900">
              По ссылке «{username}» мастера нет
            </h1>
            <p className="mt-3 text-slate-500">
              Возможно, мастер сменил короткую ссылку. Найдите его в поиске — витрины мастеров
              по-прежнему открыты по обычным адресам.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                to="/search"
                className="rounded-xl bg-pink-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-pink-600"
              >
                Найти мастера
              </Link>
              <Link
                to="/"
                className="rounded-xl border border-pink-200 px-6 py-3 text-sm font-medium text-pink-600 transition hover:bg-pink-50"
              >
                На главную
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return <MasterPage slugOverride={data.slug} />;
}
