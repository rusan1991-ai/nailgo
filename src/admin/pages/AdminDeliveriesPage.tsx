/**
 * Очередь доставки в админке.
 *
 * Здесь видно, что и кому ушло: подтверждения, напоминания о визите, отмены.
 * Сообщение с ошибкой можно повторить после починки канала, а сам канал
 * (мессенджеры, журнал системы, вебхук) переключается на ходу, без перезапуска.
 */
import { useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, Send } from "lucide-react";
import {
  dispatchDeliveries,
  deliveryTime,
  kindLabel,
  saveDeliverySettings,
  sendDeliveryNow,
  STATUS_LABELS,
  useDeliveries,
  useDeliverySettings,
  type DeliveryItem,
  type DeliveryStatus,
} from "../../api/deliveries";
import { cn } from "../../utils/cn";

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "queued", label: "В очереди" },
  { id: "sent", label: "Отправленные" },
  { id: "failed", label: "С ошибкой" },
  { id: "cancelled", label: "Отменённые" },
];

/** Подписи каналов: в таблице должно быть понятно, куда ушло сообщение. */
const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  max: "Max",
  log: "журнал",
  webhook: "вебхук",
  email: "почта",
};

const STATUS_STYLE: Record<DeliveryStatus, string> = {
  queued: "bg-amber-50 text-amber-700",
  sent: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  cancelled: "bg-slate-100 text-slate-500",
};

/**
 * Транспорты доставки. SMS у площадки нет: сообщение уходит либо в мессенджер
 * по привязке человека (`auto`), либо в журнал системы, либо на свой вебхук.
 */
const TRANSPORTS = [
  { id: "auto", label: "Мессенджер", hint: "Telegram, если привязан, иначе Max; без привязки — журнал системы" },
  { id: "log", label: "Журнал системы", hint: "Ничего не отправляется наружу — режим стенда" },
  { id: "webhook", label: "Вебхук", hint: "POST-запрос на свой адрес: обработчик или внешний шлюз" },
];

export function AdminDeliveriesPage() {
  const [status, setStatus] = useState("all");
  const { data, loading, error, reload } = useDeliveries({ status });
  const settings = useDeliverySettings();

  const [transport, setTransport] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const currentTransport = transport ?? settings.data?.transport ?? "auto";
  const currentWebhook = webhookUrl ?? settings.data?.webhookUrl ?? "";

  const saveSettings = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await saveDeliverySettings({ transport: currentTransport, webhookUrl: currentWebhook || undefined });
      settings.reload();
      setNotice("Настройки доставки сохранены");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  };

  const dispatch = async () => {
    setNotice(null);
    const result = await dispatchDeliveries();
    setNotice(
      `Отправлено: ${result.sent}, с ошибкой: ${result.failed}, осталось в очереди: ${result.pending}`,
    );
    reload();
  };

  const retry = async (item: DeliveryItem) => {
    setBusyId(item.id);
    setNotice(null);
    try {
      const result = await sendDeliveryNow(item.id);
      setNotice(
        result.ok
          ? `Сообщение для ${item.recipient} отправлено`
          : `Не получилось: ${result.error ?? "провайдер отказал"}`,
      );
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const counters = (data?.items ?? []).reduce(
    (acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-4" data-page="admin-deliveries">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Доставка сообщений</h1>
            <p className="mt-1 text-sm text-slate-500">
              Коды входа, подтверждения и напоминания о визите уходят через очередь: видно, что отправлено,
              что ждёт и что упало.
            </p>
          </div>
          <button
            type="button"
            onClick={dispatch}
            data-action="dispatch"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Send className="h-4 w-4" /> Отправить сейчас
          </button>
        </div>

        {notice && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{notice}</p>}

        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
          {(["queued", "sent", "failed", "cancelled"] as DeliveryStatus[]).map((key) => (
            <div key={key} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="text-slate-500">{STATUS_LABELS[key]}</p>
              <p className="text-lg font-semibold" data-counter={key}>
                {counters[key] ?? 0}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold">Канал доставки</h2>
        <p className="mt-1 text-sm text-slate-500">
          Переключается на ходу — перезапуск сервера не нужен. Сейчас:{" "}
          <span className="font-medium text-slate-700" data-field="transport">
            {currentTransport}
          </span>
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {TRANSPORTS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTransport(item.id)}
              data-transport={item.id}
              aria-pressed={currentTransport === item.id}
              className={cn(
                "rounded-xl border px-3 py-2 text-left transition",
                currentTransport === item.id ? "border-pink-400 bg-[#fff4f8]" : "border-slate-200 hover:border-pink-200",
              )}
            >
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{item.hint}</span>
            </button>
          ))}
        </div>

        {(currentTransport === "webhook" || currentWebhook) && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={currentWebhook}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="Адрес приёмника, например https://hook.example.ru/nailgo"
              data-field="webhook-url"
              className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-300"
            />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveSettings}
            disabled={saving}
            data-action="save-settings"
            className="rounded-xl bg-pink-500 px-4 py-2 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-60"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
          {settings.data && (
            <p className="text-xs text-slate-400">
              Неудачные попытки повторяются до {settings.data.maxAttempts} раз; рассыльщик проверяет очередь каждые{" "}
              {settings.data.intervalSeconds} с. Боты: Telegram —{" "}
              {settings.data.channels?.telegram ? "подключён" : "нет токена"}, Max —{" "}
              {settings.data.channels?.max ? "подключён" : "нет токена"}. SMS не отправляем — их нет в системе.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatus(filter.id)}
                data-filter={filter.id}
                aria-pressed={status === filter.id}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition",
                  status === filter.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <RefreshCw className="h-4 w-4" /> Обновить
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
            Не удалось загрузить очередь: {error}
          </p>
        )}
        {loading && !data && <p className="mt-3 text-sm text-slate-500">Загружаем очередь…</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2 pr-4">Время</th>
                <th className="pb-2 pr-4">Кому</th>
                <th className="pb-2 pr-4">Что</th>
                <th className="pb-2 pr-4">Текст</th>
                <th className="pb-2 pr-4">Статус</th>
                <th className="pb-2">Действие</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((item) => (
                <tr key={item.id} data-delivery={item.id} data-status={item.status} className="border-t border-slate-100">
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-500">
                    {deliveryTime(item.sentAt ?? item.scheduledFor)}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <span className="text-slate-700">{item.recipient}</span>
                    <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      {CHANNEL_LABELS[item.channel] ?? item.channel}
                    </span>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-600">{kindLabel(item.kind)}</td>
                  <td className="py-2 pr-4 text-slate-600">{item.body}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <span className={cn("rounded-lg px-2 py-1 text-xs", STATUS_STYLE[item.status])}>
                      {STATUS_LABELS[item.status]}
                    </span>
                    {item.attempts > 0 && <span className="ml-2 text-xs text-slate-400">попыток: {item.attempts}</span>}
                    {item.error && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-rose-500">
                        <AlertTriangle className="h-3 w-3" /> {item.error}
                      </span>
                    )}
                    {item.status === "sent" && item.provider && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
                        <Check className="h-3 w-3" /> {item.provider}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {item.status !== "sent" && item.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={() => retry(item)}
                        disabled={busyId === item.id}
                        data-action="retry"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        {busyId === item.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        Отправить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data && data.items.length === 0 && !loading && (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              В этой категории сообщений нет. Отправьте тестовую запись с сайта — она появится здесь вместе
              с напоминанием о визите.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
