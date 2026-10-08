/**
 * Записи клиента. Источник правды — API: список приходит по номеру телефона
 * авторизованного пользователя, отмена подтверждается тем же номером.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatDateLabel, formatTimeLabel, parseTimeLabel } from "../store/bookings";
import type { StartedPayment } from "../api/payments";

export type BookingItem = {
  id: string;
  /** Нужны для переноса записи: окна считаются по мастеру и услуге. */
  masterSlug: string;
  serviceId: string;
  durationMinutes: number;
  /** «2024-05-22» и минуты от полуночи: нужны для переноса записи. */
  dateISO: string;
  startMinutes: number;
  date: string;
  time: string;
  master: string;
  service: string;
  address: string;
  price: number;
  /** Предоплата по записи: 0 — платить не нужно. */
  prepaymentAmount: number;
  paymentStatus: "none" | "pending" | "paid" | "refunded";
  status: "upcoming" | "completed" | "cancelled" | "no_show";
  /**
   * Можно ли отменить визит онлайн. Считает сервер: до визита меньше 6 часов —
   * кнопка закрыта, а клиент видит причину и связывается с мастером.
   */
  canCancel: boolean;
  cancelBlockedReason: string | null;
  /** Отзыв по визиту: null, если его ещё нет — тогда интерфейс предлагает оставить. */
  review: {
    id: string;
    score: number;
    text: string;
    status: "published" | "moderation" | "hidden";
    replyText: string | null;
  } | null;
};

type ApiBooking = {
  id: string;
  masterSlug: string;
  masterName: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  dateISO: string;
  startMinutes: number;
  price: number;
  prepaymentAmount?: number;
  paymentStatus?: "none" | "pending" | "paid" | "refunded";
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  canCancel?: boolean;
  cancelBlockedReason?: string | null;
  address: string;
  /** Отзыв по визиту: null, если отзыва ещё нет. */
  review: {
    id: string;
    score: number;
    text: string;
    status: "published" | "moderation" | "hidden";
    replyText: string | null;
  } | null;
};

type CreateBookingPayload = {
  masterSlug: string;
  serviceId: string;
  /** Дата в формате 2024-05-22 */
  dateISO: string;
  /** Метка времени, как её видит клиент: «19:00». */
  time: string;
  clientName?: string;
  clientPhone?: string;
  comment?: string;
};

type BookingContextValue = {
  bookings: BookingItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Создание записи: вместе с записью приходит и ссылка на предоплату. */
  createBooking: (payload: CreateBookingPayload) => Promise<{ booking: BookingItem; payment: StartedPayment }>;
  cancelBooking: (id: string) => Promise<void>;
};

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

function toItem(booking: ApiBooking): BookingItem {
  return {
    id: booking.id,
    masterSlug: booking.masterSlug,
    serviceId: booking.serviceId,
    durationMinutes: booking.durationMinutes,
    dateISO: booking.dateISO,
    startMinutes: booking.startMinutes,
    date: formatDateLabel(booking.dateISO),
    time: formatTimeLabel(booking.startMinutes),
    master: booking.masterName,
    service: booking.serviceName,
    address: booking.address ?? "",
    price: booking.price,
    prepaymentAmount: booking.prepaymentAmount ?? 0,
    paymentStatus: booking.paymentStatus ?? "none",
    // Неявка — визит не состоялся: в интерфейсе клиента она живёт рядом
    // с отменами, но подписана отдельно («Неявка»).
    status:
      booking.status === "cancelled" || booking.status === "no_show"
        ? booking.status === "no_show"
          ? "no_show"
          : "cancelled"
        : booking.status === "completed"
          ? "completed"
          : "upcoming",
    canCancel: booking.canCancel ?? false,
    cancelBlockedReason: booking.cancelBlockedReason ?? null,
    review: booking.review ?? null,
  };
}

export function BookingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const phone = user?.phone ?? "";
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!phone) {
      setBookings([]);
      return;
    }
    setLoading(true);
    try {
      // Записи отдаются по токену сессии: подставлять телефон в запрос не нужно.
      const data = await api.get<{ items: ApiBooking[] }>("/bookings");
      setBookings(data.items.map(toItem));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Не удалось загрузить записи");
    } finally {
      setLoading(false);
    }
  }, [phone]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<BookingContextValue>(
    () => ({
      bookings,
      loading,
      error,
      reload,
      createBooking: async (payload) => {
        setError(null);
        const clientPhone = payload.clientPhone?.trim() || phone;
        const clientName = payload.clientName?.trim() || user?.name || "Клиент NailGo";
        try {
          const response = await api.post<{ booking: ApiBooking; payment?: StartedPayment }>("/bookings", {
            masterSlug: payload.masterSlug,
            serviceId: payload.serviceId,
            dateISO: payload.dateISO,
            startMinutes: parseTimeLabel(payload.time),
            clientName,
            clientPhone,
            comment: payload.comment?.trim() || undefined,
          });
          const item = toItem(response.booking);
          setBookings((current) => [item, ...current.filter((booking) => booking.id !== item.id)]);
          return { booking: item, payment: response.payment ?? { status: "none" } };
        } catch (caught) {
          const message = caught instanceof ApiError ? caught.message : "Не удалось создать запись";
          setError(message);
          throw caught;
        }
      },
      cancelBooking: async (id) => {
        setError(null);
        try {
          await api.post(`/bookings/${id}/cancel`);
          setBookings((current) =>
            current.map((booking) => (booking.id === id ? { ...booking, status: "cancelled" } : booking)),
          );
        } catch (caught) {
          const message = caught instanceof ApiError ? caught.message : "Не удалось отменить запись";
          setError(message);
          throw caught;
        }
      },
    }),
    [bookings, loading, error, reload, phone, user],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBookings() {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error("useBookings must be used inside BookingProvider");
  }
  return context;
}
