/**
 * Предоплаты в админке.
 *
 * Деньги по записям: сколько получено, сколько ждём, что вернули и что не
 * прошло. Здесь же переключается способ приёма предоплаты — мастер принимает
 * перевод сам (`manual`) или работает платёжный шлюз (`webhook`), который
 * сообщает об оплате вебхуком.
 */
import { useState } from "react";
import { CreditCard, Loader2, RefreshCw, Undo2 } from "lucide-react";
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  confirmPayment,
  paymentTime,
  refundPayment,
  savePaymentSettings,
  useAdminPayments,
  type AdminPaymentItem,
} from "../../api/payments";
import { formatRub } from "../../data/mock";
import { cn } from "../../utils/cn";

const STATUS_FILTERS = [
  { id: "all", label: "Все" },
  { id: "pending", label: "Ждём оплату" },
  { id: "paid", label: "Оплаченные" },
  { id: "refunded", label: "Возвраты" },
  { id: "failed", label: "С ошибкой" },
];

const PROVIDERS = [
  { id: "manual", label: "Мастер принимает сам", hint: "Перевод или наличные: оплату подтверждает мастер" },
  { id: "webhook", label: "Платёжный шлюз", hint: "Ссылка на оплату и вебхук от провайдера" },
];

function Counter({
  label,
  count,
  amount,
  tone,
}: {
  label: string;
  count: number;
  amount: number;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold", tone)} data-counter={label}>
        {formatRub(amount)}
      </p>
      <p className="text-xs text-slate-400">операций: {count}</p>
    </div>
  );
}

export function AdminPaymentsPage() {
  const [status, setStatus] = useState("all");
  const { data, loading, error, reload } = useAdminPayments({ status });

  const [provider, setProvider] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const currentProvider = provider ?? data?.provider ?? "manual";
  const currentWebhook = webhookUrl ?? data?.webhookUrl ?? "";

  const saveSettings = async () => {
    setSaving(true);
    setNotice(null);
    try {
      // Пустой адрес убирает сохранённое значение — снова действует окружение.
      await savePaymentSettings({
        provider: currentProvider as "manual" | "webhook",
        webhookUrl: currentWebhook || "",
      });
      setWebhookUrl(null);
      setProvider(null);
      reload();
      setNotice("Настройки приёма предоплаты сохранены");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  };

  const runPaymentAction = async (item: AdminPaymentItem, action: "paid" | "refund") => {
    setBusyId(item.id);
    setNotice(null);
    try {
      if (action === "paid") await confirmPayment(item.id);
      else await refundPayment(item.id);
      setNotice(
        action === "paid"
          ? `Предоплата ${formatRub(item.amount)} отмечена полученной`
          : `Предоплата ${formatRub(item.amount)} возвращена`,
      );
      reload();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Не удалось выполнить действие");
    } finally {
      setBusyId(null);
    }
  };

  const summary = data?.summary;

  return (
    <div className="space-y-5" data-page="admin-payments">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Предоплаты</h1>
          <p className="mt-1 text-sm text-slate-500">
            Деньги по записям: полученные предоплаты, ожидание оплаты и возвраты.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          data-action="reload"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" /> Обновить
        </button>
      </div>

      {notice && (
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600" data-notice>
          {notice}
        </p>
      )}

      {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Counter
          label="Получено"
          count={summary?.paid.count ?? 0}
          amount={summary?.paid.amount ?? 0}
          tone="text-emerald-600"
        />
        <Counter
          label="Ждём оплату"
          count={summary?.pending.count ?? 0}
          amount={summary?.pending.amount ?? 0}
          tone="text-amber-600"
        />
        <Counter
          label="Возвращено"
          count={summary?.refunded.count ?? 0}
          amount={summary?.refunded.amount ?? 0}
          tone="text-slate-500"
        />
        <Counter
          label="Не прошло"
          count={summary?.failed.count ?? 0}
          amount={summary?.failed.amount ?? 0}
          tone="text-rose-500"
        />
      </div>

      <div className="rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-pink-500" />
          <h2 className="font-medium text-slate-700">Как принимаем предоплату</h2>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PROVIDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setProvider(item.id)}
              data-provider={item.id}
              className={cn(
                "rounded-2xl border p-4 text-left text-sm transition",
                currentProvider === item.id
                  ? "border-pink-400 bg-pink-50/50"
                  : "border-slate-200 hover:border-pink-200",
              )}
            >
              <p className="font-medium text-slate-700">{item.label}</p>
              <p className="mt-1 text-xs text-slate-500">{item.hint}</p>
            </button>
          ))}
        </div>

        {currentProvider === "webhook" && (
          <label className="mt-3 block text-sm text-slate-600">
            Адрес шлюза
            <input
              value={currentWebhook}
              onChange={(event) => setWebhookUrl(event.target.value)}
              data-field="payment-webhook"
              placeholder="https://gateway.example.ru/pay"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Мы отправим туда операцию и ждём ответ со ссылкой на оплату. Об оплате шлюз сообщит вебхуком
              POST /api/payments/webhook.
            </span>
          </label>
        )}

        <button
          type="button"
          onClick={() => void saveSettings()}
          disabled={saving}
          data-action="save-payment-settings"
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-pink-500 px-4 py-2 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setStatus(filter.id)}
            data-filter={filter.id}
            className={cn(
              "rounded-xl border px-3 py-1.5 text-sm transition",
              status === filter.id
                ? "border-pink-400 bg-pink-50 text-pink-600"
                : "border-slate-200 text-slate-600 hover:border-pink-200",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-100">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium">Операция</th>
              <th className="px-5 py-3 font-medium">Клиент</th>
              <th className="px-5 py-3 font-medium">Мастер и услуга</th>
              <th className="px-5 py-3 font-medium">Сумма</th>
              <th className="px-5 py-3 font-medium">Статус</th>
              <th className="px-5 py-3 text-right font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id} data-payment-row={item.id} data-status={item.status} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3.5">
                  <p className="text-slate-700">{paymentTime(item.createdAt)}</p>
                  <p className="text-xs text-slate-400">
                    {item.provider === "webhook" ? "шлюз" : "мастер"} · запись {item.bookingId.slice(0, 8)}
                  </p>
                </td>
                <td className="px-5 py-3.5">
                  <p className="text-slate-700">{item.clientName}</p>
                  <p className="text-xs text-slate-400">{item.clientPhone}</p>
                </td>
                <td className="px-5 py-3.5">
                  <p className="text-slate-700">{item.masterName}</p>
                  <p className="text-xs text-slate-400">{item.serviceName}</p>
                </td>
                <td className="px-5 py-3.5 font-medium text-slate-700">
                  {formatRub(item.amount)}
                  <span className="block text-xs font-normal text-slate-400">
                    из {formatRub(item.price)}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", PAYMENT_STATUS_TONES[item.status])}>
                    {PAYMENT_STATUS_LABELS[item.status]}
                  </span>
                  {item.error && <p className="mt-1 text-xs text-rose-500">{item.error}</p>}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-2">
                    {item.status === "pending" && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void runPaymentAction(item, "paid")}
                        data-action="mark-paid"
                        className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        Деньги пришли
                      </button>
                    )}
                    {item.status === "paid" && (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void runPaymentAction(item, "refund")}
                        data-action="refund"
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Вернуть
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loading && !data && <p className="px-5 py-8 text-sm text-slate-400">Загружаем операции…</p>}
        {data && data.items.length === 0 && (
          <p className="px-5 py-8 text-sm text-slate-400">По этому фильтру операций нет.</p>
        )}
      </div>
    </div>
  );
}
