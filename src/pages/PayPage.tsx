/**
 * Страница предоплаты.
 *
 * Клиент видит, сколько и за что платит, и уходит на оплату в шлюз (или
 * переводит мастеру, если шлюз не подключён). Отдельная страница нужна
 * потому, что оплата — не мгновенное действие: клиент возвращается сюда
 * после платежа, а мастер и администратор — чтобы подтвердить поступление.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CreditCard, RefreshCw } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { formatRub } from "../data/mock";
import { formatDateLabel, formatTimeLabel } from "../store/bookings";
import {
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  confirmPayment,
  declarePayment,
  fetchPayment,
  paymentTime,
  refundPayment,
  startPaymentForBooking,
  type PaymentPageData,
} from "../api/payments";

export function PayPage() {
  // В адресе — запись, а не операция: у записи может быть несколько попыток
  // оплаты, и клиенту важно «оплатить эту запись», а не конкретный платёж.
  const { id = "" } = useParams();
  const [paymentId, setPaymentId] = useState("");
  const [data, setData] = useState<PaymentPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(
    async (target = paymentId) => {
      setLoading(true);
      try {
        if (!target) {
          // По записи находим (или создаём) операцию — дальше работаем с ней.
          const started = await startPaymentForBooking(id);
          if (!started.payment.paymentId) {
            setError(started.payment.error ?? "Для этой записи предоплата не нужна");
            setData(null);
            return;
          }
          setPaymentId(started.payment.paymentId);
          setData(await fetchPayment(started.payment.paymentId));
        } else {
          setData(await fetchPayment(target));
        }
        setError("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось открыть оплату");
      } finally {
        setLoading(false);
      }
    },
    [id, paymentId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setPending(true);
    setNotice("");
    try {
      await action();
      setNotice(message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не получилось, попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  };

  const payment = data?.payment;
  const booking = data?.booking;

  return (
    <main className="n2g-min-h-viewport bg-[#fff7fa] p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-[720px] rounded-[26px] border border-[#ffe6ef] bg-white p-5 shadow-[0_20px_80px_-40px_rgba(236,72,153,0.45)] sm:p-8">
        <AppHeader />

        <div className="mt-6" data-page="pay">
          <Link to="/account" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-pink-600">
            <ArrowLeft className="h-4 w-4" /> Мои записи
          </Link>

          <h1 className="mt-3 text-3xl font-semibold">Предоплата за запись</h1>

          {loading && !data && <p className="mt-6 text-sm text-slate-500">Открываем оплату…</p>}

          {error && (
            <p className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>
          )}

          {notice && (
            <p className="mt-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>
          )}

          {payment && booking && (
            <>
              <div className="mt-6 rounded-2xl border border-[#f1dde6] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-pink-500">Сумма предоплаты</p>
                    <p className="mt-1 text-4xl font-semibold" data-field="payment-amount">
                      {formatRub(payment.amount)}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Стоимость услуги {formatRub(booking.price)} — остаток отдадите мастеру после визита.
                    </p>
                  </div>
                  <span
                    data-status={payment.status}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                      PAYMENT_STATUS_TONES[payment.status] ?? "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                  </span>
                </div>

                <div className="mt-5 space-y-2 border-t border-[#f6e7ee] pt-4 text-sm">
                  <p className="font-medium">{booking.serviceName}</p>
                  <p className="text-slate-500">{booking.masterName}</p>
                  <p className="text-slate-500">
                    {formatDateLabel(booking.dateISO)}, {formatTimeLabel(new Date(booking.startAt).getUTCHours() * 60 + new Date(booking.startAt).getUTCMinutes())}
                  </p>
                  <p className="text-slate-500">
                    Запись{" "}
                    {booking.status === "cancelled"
                      ? "отменена"
                      : booking.status === "confirmed"
                        ? "подтверждена"
                        : "ждёт подтверждения"}
                    .
                  </p>
                </div>
              </div>

              {payment.status === "paid" && (
                <div className="mt-5 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-medium">Предоплата получена</p>
                    <p>Оплата отмечена {paymentTime(payment.paidAt)}. Запись подтверждена, мастер вас ждёт.</p>
                  </div>
                </div>
              )}

              {payment.status === "refunded" && (
                <div className="mt-5 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                  Предоплата возвращена {paymentTime(payment.refundedAt)}.
                </div>
              )}

              {payment.status === "pending" && (
                <div className="mt-5 space-y-4">
                  {payment.payUrl && payment.payUrl.startsWith("http") && !payment.payUrl.includes("/pay/") && (
                    <a
                      href={payment.payUrl}
                      target="_blank"
                      rel="noreferrer"
                      data-action="go-gateway"
                      className="inline-flex items-center gap-2 rounded-xl bg-pink-500 px-5 py-3 font-medium text-white hover:bg-pink-600"
                    >
                      <CreditCard className="h-4 w-4" /> Перейти к оплате
                    </a>
                  )}

                  {data?.provider === "manual" && (
                    <div className="rounded-2xl border border-[#f1dde6] p-4 text-sm text-slate-600">
                      <p className="font-medium text-slate-800">Оплата мастеру</p>
                      <p className="mt-1">
                        Переведите {formatRub(payment.amount)} мастеру {booking.masterName} — картой по номеру телефона
                        или наличными при визите. Затем нажмите кнопку ниже: мастер увидит, что деньги отправлены.
                      </p>
                      <button
                        onClick={() => void run(() => declarePayment(payment.id), "Мастер увидит, что вы оплатили.")}
                        disabled={pending}
                        data-action="declare"
                        className="mt-3 rounded-xl border border-pink-300 px-4 py-2 font-medium text-pink-600 hover:bg-pink-50 disabled:opacity-50"
                      >
                        Я оплатил(а)
                      </button>
                    </div>
                  )}

                  {payment.error && (
                    <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">{payment.error}</p>
                  )}

                  <button
                    onClick={() => void run(() => startPaymentForBooking(booking.id), "Ссылка на оплату обновлена.")}
                    disabled={pending}
                    data-action="retry-start"
                    className="inline-flex items-center gap-2 rounded-xl border border-[#f1dde6] px-4 py-2 text-sm text-slate-600 hover:border-pink-300 disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" /> Получить ссылку на оплату заново
                  </button>
                </div>
              )}

              {data?.canConfirm && payment.status === "pending" && (
                <div className="mt-5 rounded-2xl border border-emerald-100 bg-[#f4fcf8] p-4 text-sm text-emerald-800">
                  <p className="font-medium">Мастеру и администратору</p>
                  <p className="mt-1">Подтвердите, когда деньги придут на счёт: запись подтвердится автоматически.</p>
                  <button
                    onClick={() => void run(() => confirmPayment(payment.id), "Оплата подтверждена.")}
                    disabled={pending}
                    data-action="confirm-paid"
                    className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Деньги пришли
                  </button>
                </div>
              )}

              {data?.canConfirm && payment.status === "paid" && (
                <div className="mt-5">
                  <button
                    onClick={() => void run(() => refundPayment(payment.id), "Предоплата возвращена.")}
                    disabled={pending}
                    data-action="refund"
                    className="rounded-xl border border-rose-200 px-4 py-2 text-sm text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Вернуть предоплату
                  </button>
                </div>
              )}

              {data && data.history.length > 1 && (
                <div className="mt-6">
                  <p className="text-sm font-medium text-slate-600">История операций</p>
                  <ul className="mt-2 space-y-2 text-sm text-slate-500">
                    {data.history.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-3 border-b border-[#f6e7ee] pb-1">
                        <span>{paymentTime(item.createdAt)}</span>
                        <span>{formatRub(item.amount)}</span>
                        <span>{PAYMENT_STATUS_LABELS[item.status] ?? item.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
