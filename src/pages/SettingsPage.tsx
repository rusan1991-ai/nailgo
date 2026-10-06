import { useState } from "react";
import { ClientShell } from "../components/ClientShell";

export function SettingsPage() {
  const [reminders, setReminders] = useState(true);
  const [news, setNews] = useState(true);

  return (
    <ClientShell title="Настройки">
      <div className="max-w-2xl space-y-3">
        <article className="rounded-2xl border border-[#f1dde6] p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">Уведомления о записи</p>
            <button
              onClick={() => setReminders((v) => !v)}
              className={`h-7 w-12 rounded-full p-1 transition ${reminders ? "bg-pink-500" : "bg-slate-300"}`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white transition ${reminders ? "translate-x-5" : ""}`} />
            </button>
          </div>
        </article>

        <article className="rounded-2xl border border-[#f1dde6] p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">Акции и новости</p>
            <button
              onClick={() => setNews((v) => !v)}
              className={`h-7 w-12 rounded-full p-1 transition ${news ? "bg-pink-500" : "bg-slate-300"}`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white transition ${news ? "translate-x-5" : ""}`} />
            </button>
          </div>
        </article>

        <article className="rounded-2xl border border-[#f1dde6] p-4 text-sm text-slate-600">
          <p>Язык: Русский</p>
          <p className="mt-2">Валюта: ₽ RUB</p>
        </article>
      </div>
    </ClientShell>
  );
}