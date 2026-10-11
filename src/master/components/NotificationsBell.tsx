/**
 * Колокольчик с непрочитанными уведомлениями мастера.
 *
 * Данные — из /api/notifications: клиент, записавшийся к мастеру, попадает сюда
 * («Новая заявка»), поэтому счётчик реальный, а не из макета.
 */
import { useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { markNotificationsRead, notificationTime, useNotifications } from "../../api/notifications";
import { cn } from "../../utils/cn";

export function NotificationsBell({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, reload } = useNotifications(8);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-notifications]")) return;
      setOpen(false);
    };
    window.document.addEventListener("click", close);
    return () => window.document.removeEventListener("click", close);
  }, [open]);

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  const markAll = async () => {
    setBusy(true);
    try {
      await markNotificationsRead({ all: true });
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" data-notifications>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
          tone === "dark"
            ? "text-slate-400 hover:bg-white/5 hover:text-slate-100"
            : "border border-slate-200 text-slate-500 hover:bg-slate-50",
        )}
      >
        <Bell className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 text-left">Уведомления</span>
        {unread > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#e11d48] px-1.5 text-[11px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-30 w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl",
            tone === "dark" ? "bottom-full left-0 mb-2" : "right-0 top-11",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Уведомления</p>
            {unread > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void markAll()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#e11d48] disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Прочитано
              </button>
            )}
          </div>

          <ul className="max-h-[320px] overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn("border-b border-slate-50 px-4 py-3 last:border-0", !item.read && "bg-pink-50/50")}
              >
                <p className="text-sm font-medium text-slate-800">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{item.body}</p>
                <p className="mt-1 text-[11px] text-slate-400">{notificationTime(item.createdAt)}</p>
              </li>
            ))}
            {items.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-400">
                Пока пусто: заявки клиентов появятся здесь.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
