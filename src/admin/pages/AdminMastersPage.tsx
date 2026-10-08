/**
 * Управление мастерами в админке.
 *
 * Список всех мастеров с состоянием витрины: активен, снят с публикации или
 * заблокирован. Здесь же карточка мастера — профиль, портфолио, услуги,
 * ближайшие записи и отзывы, — чтобы решение принималось по данным.
 *
 * Блокировка закрывает аккаунт целиком: мастер не войдёт (проверка на сервере)
 * и не сможет записаться к нему клиент (витрина его не показывает).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Check, ExternalLink, Loader2, Pause, X } from "lucide-react";
import {
  Card,
  CardTitle,
  Chip,
  GhostButton,
  Modal,
  PageHeader,
  PersonAvatar,
  SearchInput,
  Stars,
  type ChipTone,
} from "../../master/components/ui";
import {
  setMasterStatusAsAdmin,
  useAdminMasterCard,
  useAdminMasters,
  type AdminMaster,
  type MasterStatus,
} from "../../api/admin";
import { formatRub } from "../../data/mock";
import { cn } from "../../utils/cn";

const statusMeta: Record<MasterStatus, { label: string; tone: ChipTone }> = {
  active: { label: "Активен", tone: "green" },
  paused: { label: "Снят с публикации", tone: "amber" },
  blocked: { label: "Заблокирован", tone: "red" },
};

const filters: { id: string; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "active", label: "Активные" },
  { id: "paused", label: "Снятые с публикации" },
  { id: "blocked", label: "Заблокированные" },
];

export function AdminMastersPage() {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminMasters({ status, query });

  const items = useMemo(() => data?.items ?? [], [data]);

  /** Смена статуса: причина обязательна для паузы и блокировки. */
  const changeStatus = async (master: AdminMaster, next: MasterStatus) => {
    setActionError(null);
    let reason: string | undefined;
    if (next === "paused" || next === "blocked") {
      const question =
        next === "blocked"
          ? `Причина блокировки «${master.name}» (её увидит мастер и она останется в карточке):`
          : `Причина снятия с публикации «${master.name}»:`;
      const answer = window.prompt(question, next === "blocked" ? "нарушение правил площадки" : "не отвечает клиентам");
      if (answer === null) return;
      reason = answer.trim();
      if (!reason) {
        setActionError("Без причины статус не меняется — мастер должен понимать, что произошло.");
        return;
      }
    }
    setBusyId(master.id);
    try {
      await setMasterStatusAsAdmin(master.id, next, reason);
      reload();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Не удалось сменить статус");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5" data-block="admin-masters">
      <PageHeader
        title="Мастера"
        subtitle="Состояние витрины и аккаунтов: активные, снятые с публикации, заблокированные"
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatus(filter.id)}
              data-filter={filter.id}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition",
                status === filter.id ? "bg-pink-500 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {filter.label}
              {filter.id !== "all" && data ? ` · ${data.byStatus[filter.id as MasterStatus]}` : ""}
            </button>
          ))}
          <div className="ml-auto w-full max-w-xs">
            <SearchInput placeholder="Имя, метро или город" value={query} onChange={setQuery} />
          </div>
        </div>

        {actionError && <p className="mt-3 text-sm text-rose-600">{actionError}</p>}
        {loading && <p className="mt-4 text-sm text-slate-500">Загружаем мастеров…</p>}
        {error && <p className="mt-4 text-sm text-rose-600">Не удалось загрузить список: {error}</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2 pr-4">Мастер</th>
                <th className="pb-2 pr-4">Статус</th>
                <th className="pb-2 pr-4">Место</th>
                <th className="pb-2 pr-4">Цифры</th>
                <th className="pb-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((master) => (
                <tr key={master.id} data-master={master.slug} data-status={master.status} className="border-t border-slate-100">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <PersonAvatar name={master.name} src={master.avatarUrl} size={40} />
                      <div className="min-w-0">
                        <button
                          type="button"
                          data-action="open-card"
                          onClick={() => setOpenId(master.id)}
                          className="block truncate font-medium text-slate-800 hover:text-pink-600"
                        >
                          {master.name}
                        </button>
                        <p className="truncate text-xs text-slate-500">{master.tags}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <Chip tone={statusMeta[master.status].tone}>{statusMeta[master.status].label}</Chip>
                    {master.statusReason && <p className="mt-1 max-w-[220px] text-xs text-slate-500">{master.statusReason}</p>}
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    <p>{master.city}</p>
                    <p className="text-xs text-slate-400">{master.metro}</p>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    <p>
                      ★ {master.rating} · {master.reviewsTotal} отзывов
                    </p>
                    <p className="text-xs text-slate-400">
                      {master.servicesCount} услуг · {master.bookingsCount} записей · от {formatRub(master.priceFrom)}
                    </p>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {master.status !== "active" && (
                        <button
                          type="button"
                          data-action="activate"
                          disabled={busyId === master.id}
                          onClick={() => void changeStatus(master, "active")}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" /> Вернуть в витрину
                        </button>
                      )}
                      {master.status === "active" && (
                        <button
                          type="button"
                          data-action="pause"
                          disabled={busyId === master.id}
                          onClick={() => void changeStatus(master, "paused")}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                        >
                          <Pause className="h-3.5 w-3.5" /> Снять с публикации
                        </button>
                      )}
                      {master.status !== "blocked" && (
                        <button
                          type="button"
                          data-action="block"
                          disabled={busyId === master.id}
                          onClick={() => void changeStatus(master, "blocked")}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          <Ban className="h-3.5 w-3.5" /> Заблокировать
                        </button>
                      )}
                      {busyId === master.id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && items.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Мастеров по фильтру нет</p>}
        </div>
      </Card>

      <MasterCardModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** Карточка мастера: всё, что нужно для решения по его доступу. */
function MasterCardModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, loading, error } = useAdminMasterCard(id);

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={data?.master.name ?? "Карточка мастера"} subtitle={data?.master.tags} width="max-w-3xl">
      {loading && <p className="text-sm text-slate-500">Загружаем карточку…</p>}
      {error && <p className="text-sm text-rose-600">Не удалось загрузить: {error}</p>}
      {data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start gap-4">
            <PersonAvatar name={data.master.name} src={data.media.avatar?.thumbUrl ?? null} size={64} />
            <div className="min-w-0 flex-1 space-y-1 text-sm text-slate-600">
              <p>
                <span className="font-medium text-slate-800">{data.master.city}</span> · {data.master.metro}
                {data.master.address ? ` · ${data.master.address}` : ""}
              </p>
              <p>
                ★ {data.master.rating} ({data.master.reviewsCount} отзывов) · опыт {data.master.experience} · от{" "}
                {formatRub(data.master.priceFrom)}
              </p>
              <p className="text-xs text-slate-500">
                Пояс {data.master.timezone}
                {data.account?.phone ? ` · телефон ${data.account.phone}` : " · телефон не указан"}
                {data.account ? "" : " · аккаунта нет"}
              </p>
              {data.master.statusReason && (
                <p className="text-xs text-amber-600">Решение площадки: {data.master.statusReason}</p>
              )}
              {data.account?.blockedAt && <p className="text-xs text-rose-600">Аккаунт заблокирован: {data.account.blockedReason}</p>}
            </div>
            <div className="flex flex-col items-end gap-2">
              <Chip tone={statusMeta[data.master.status].tone}>{statusMeta[data.master.status].label}</Chip>
              <Link
                to={`/master/${data.master.slug}`}
                className="inline-flex items-center gap-1 text-xs text-pink-600 hover:text-pink-700"
              >
                Витрина <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card padded={false} className="p-4">
              <CardTitle>Услуги ({data.services.length})</CardTitle>
              <ul className="space-y-1.5 text-sm">
                {data.services.slice(0, 6).map((service) => (
                  <li key={service.id} className="flex items-center justify-between gap-2">
                    <span className={cn("truncate", service.active ? "text-slate-700" : "text-slate-400 line-through")}>
                      {service.name}
                    </span>
                    <span className="whitespace-nowrap text-slate-500">
                      {formatRub(service.price)} · {service.durationMinutes} мин
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card padded={false} className="p-4">
              <CardTitle>Ближайшие записи ({data.upcoming.length})</CardTitle>
              {data.upcoming.length === 0 ? (
                <p className="text-sm text-slate-500">Записей впереди нет</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {data.upcoming.slice(0, 6).map((booking) => (
                    <li key={booking.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-700">
                        {booking.dateISO} · {booking.clientName}
                      </span>
                      <span className="whitespace-nowrap text-slate-500">{booking.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">
              Портфолио ({data.media.portfolio.length + data.media.certificates.length})
            </p>
            {data.media.portfolio.length + data.media.certificates.length === 0 ? (
              <p className="text-sm text-slate-500">Мастер ещё не загрузил работы</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...data.media.portfolio, ...data.media.certificates].slice(0, 10).map((file) => (
                  <img
                    key={file.id}
                    src={file.thumbUrl}
                    alt={file.caption ?? "Работа мастера"}
                    loading="lazy"
                    data-media={file.id}
                    className="h-20 w-20 rounded-xl object-cover"
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">Отзывы ({data.reviews.length})</p>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {data.reviews.map((review) => (
                <div key={review.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700">{review.clientName}</span>
                    <Stars score={review.score} />
                  </div>
                  <p className="mt-1 text-slate-600">{review.text}</p>
                  {review.complaintText && (
                    <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      Жалоба мастера: {review.complaintText}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <GhostButton onClick={onClose}>
          <X className="h-4 w-4" /> Закрыть
        </GhostButton>
      </div>
    </Modal>
  );
}
