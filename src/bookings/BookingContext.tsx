import { createContext, useContext, useMemo } from "react";
import {
  bookingAddress,
  cancelBooking as cancelStoredBooking,
  createBooking as createStoredBooking,
  findMaster,
  formatTimeLabel,
  useBookingsStore,
} from "../store/bookings";

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

type CreateBookingPayload = {
  masterSlug: string;
  serviceId: string;
  date: string;
  time: string;
  clientName?: string;
  clientPhone?: string;
  comment?: string;
};

type BookingContextValue = {
  bookings: BookingItem[];
  createBooking: (payload: CreateBookingPayload) => BookingItem;
  cancelBooking: (id: string) => void;
};

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

/** Кабинетные статусы приводим к клиентским: клиенту важно «предстоит / прошло / отменено». */
function toClientStatus(status: ReturnType<typeof useBookingsStore>[number]["status"]): BookingItem["status"] {
  if (status === "cancelled") return "cancelled";
  if (status === "completed") return "completed";
  return "upcoming";
}

export function BookingProvider({ children }: { children: React.ReactNode }) {
  const stored = useBookingsStore();

  const value = useMemo<BookingContextValue>(() => {
    const items: BookingItem[] = stored.map((booking) => ({
      id: booking.id,
      date: booking.dateLabel,
      time: formatTimeLabel(booking.startMinutes),
      master: booking.masterName,
      service: booking.serviceName,
      address: bookingAddress(booking),
      price: booking.price,
      status: toClientStatus(booking.status),
    }));

    return {
      bookings: items,
      createBooking: ({ masterSlug, serviceId, date, time, clientName, clientPhone, comment }) => {
        const booking = createStoredBooking({
          masterSlug,
          serviceId,
          dateLabel: date,
          startMinutes: Number.parseInt(time.split(":")[0] ?? "0", 10) * 60 + Number.parseInt(time.split(":")[1] ?? "0", 10),
          clientName: clientName ?? "Мария Петрова",
          clientPhone: clientPhone ?? "+7 (999) 111-22-33",
          comment,
          source: "client",
          status: "confirmed",
        });

        return {
          id: booking.id,
          date: booking.dateLabel,
          time: formatTimeLabel(booking.startMinutes),
          master: booking.masterName,
          service: booking.serviceName,
          address: bookingAddress(booking),
          price: booking.price,
          status: toClientStatus(booking.status),
        };
      },
      cancelBooking: cancelStoredBooking,
    };
  }, [stored]);

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBookings() {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error("useBookings must be used inside BookingProvider");
  }
  return context;
}

export { findMaster };
