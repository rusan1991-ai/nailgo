import { useState } from "react";
import { CheckCheck, Info } from "lucide-react";
import { ClientShell } from "../components/ClientShell";
import { notifications as mockNotifications } from "../data/mock";
import { markNotificationsRead, notificationTime, useNotifications } from "../api/notifications";
import { cn } from "../utils/cn";

export function NotificationsPage() {
  const { data, loading, error, reload } = useNotifications();
  const [busy, setBusy] = useState(false);

  const live = Boolean(data && data.items.length > 0);
  const items = live
    ? data!.items
    : mockNotifications.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.desc,
        read: true,
        createdAt: new Date().toISOString(),
        timeLabel: item.time,
        type: "mock",
      }));

  const markAll = async () => {
    setBusy(true);
    try {
      await markNotificationsRead({ all: true });
      reload();
    } finally {
      setBusy(false);
    }
  };

  const unread = data?.unread ?? 0;

  return (
    <ClientShell title="Уведомления">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {live
            ? unread > 0
              ? `Непрочитанных: ${unread}`
              : "Все уведомления прочитаны"
            : loading
              ? "Загружаем уведомления…"
              : "API недоступен — показаны демо-уведомления"}
        </p>
        {live && unread > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void markAll()}
            className="inline-flex items-center gap-2 rounded-xl border border-[#f1dde6] px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-white disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" />
            Отметить прочитанными
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
          Не удалось загрузить уведомления: {error}
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <article
            key={item.id}
            className={cn(
              "rounded-2xl border p-4",
              item.read ? "border-[#f1dde6] bg-white" : "border-pink-200 bg-[#fff7fa]",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                    item.read ? "bg-slate-100 text-slate-400" : "bg-white text-[#e11d48]",
                  )}
                >
                  <Info className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.body}</p>
                </div>
              </div>
              <span className="whitespace-nowrap text-xs text-slate-400">
                {"timeLabel" in item ? item.timeLabel : notificationTime(item.createdAt)}
              </span>
            </div>
          </article>
        ))}
        {items.length === 0 && (
          <p className="rounded-2xl border border-dashed border-[#f1dde6] p-5 text-sm text-slate-500">
            Уведомлений пока нет: они появятся, когда вы запишетесь к мастеру или мастер изменит статус записи.
          </p>
        )}
      </div>
    </ClientShell>
  );
}
