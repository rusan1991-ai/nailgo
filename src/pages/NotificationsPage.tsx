import { ClientShell } from "../components/ClientShell";
import { notifications } from "../data/mock";

export function NotificationsPage() {
  return (
    <ClientShell title="Уведомления">
      <div className="space-y-2">
        {notifications.map((item) => (
          <article key={item.id} className="rounded-2xl border border-[#f1dde6] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-sm text-slate-500">{item.desc}</p>
              </div>
              <span className="text-xs text-slate-400">{item.time}</span>
            </div>
          </article>
        ))}
      </div>
    </ClientShell>
  );
}