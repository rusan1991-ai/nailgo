/**
 * Записи клиента. Источник правды — API: список приходит по номеру телефона
 * авторизованного пользователя, отмена подтверждается тем же номером.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatDateLabel, formatTimeLabel, parseTimeLabel } from "../store/bookings";

export type BookingItem = {
  id: string;
  date: string;
  time: string;
  master: string;
  service: string;
  address: string;
  price: number;
  status: "upcoming" | "completed" | "cancelled";
};

type ApiBooking = {
  id: string;
  masterSlug: string;
  masterName: string;
  serviceName: string;
  dateISO: string;
  startMinutes: number;
  price: number;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  address: string;
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
  createBooking: (payload: CreateBookingPayload) => Promise<BookingItem>;
  cancelBooking: (id: string) => Promise<void>;
};

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

function toItem(booking: ApiBooking): BookingItem {
  return {
    id: booking.id,
    date: formatDateLabel(booking.dateISO),
    time: formatTimeLabel(booking.startMinutes),
    master: booking.masterName,
    service: booking.serviceName,
    address: booking.address ?? "",
    price: booking.price,
    status: booking.status === "cancelled" ? "cancelled" : booking.status === "completed" ? "completed" : "upcoming",
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
      const data = await api.get<{ items: ApiBooking[] }>(`/bookings?phone=${encodeURIComponent(phone)}`);
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
          const response = await api.post<{ booking: ApiBooking }>("/bookings", {
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
          return item;
        } catch (caught) {
          const message = caught instanceof ApiError ? caught.message : "Не удалось создать запись";
          setError(message);
          throw caught;
        }
      },
      cancelBooking: async (id) => {
        setError(null);
        try {
          await api.post(`/bookings/${id}/cancel`, { phone });
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
