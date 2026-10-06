import { createContext, useContext, useMemo, useState } from "react";
import { masters, services, upcomingBookings } from "../data/mock";

type BookingStatus = "upcoming" | "completed" | "cancelled";

export type BookingItem = {
  id: string;
  date: string;
  time: string;
  master: string;
  service: string;
  address: string;
  price: number;
  status: BookingStatus;
};

type CreateBookingPayload = {
  masterSlug: string;
  serviceId: string;
  date: string;
  time: string;
};

type BookingContextValue = {
  bookings: BookingItem[];
  createBooking: (payload: CreateBookingPayload) => BookingItem;
  cancelBooking: (id: string) => void;
};

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

const seedBookings: BookingItem[] = upcomingBookings.map((item, idx) => ({
  id: item.id,
  date: item.date,
  time: item.time,
  master: item.master,
  service: item.service,
  address: item.address,
  price: idx === 0 ? 2200 : 2500,
  status: "upcoming",
}));

export function BookingProvider({ children }: { children: React.ReactNode }) {
  const [bookings, setBookings] = useState<BookingItem[]>(seedBookings);

  const value = useMemo<BookingContextValue>(
    () => ({
      bookings,
      createBooking: ({ masterSlug, serviceId, date, time }) => {
        const master = masters.find((item) => item.slug === masterSlug) ?? masters[0];
        const service = services.find((item) => item.id === serviceId) ?? services[1];

        const next: BookingItem = {
          id: `nb-${Date.now()}`,
          date,
          time,
          master: master.name,
          service: service.name,
          address: `${master.metro}, ${master.distance}`,
          price: service.price,
          status: "upcoming",
        };

        setBookings((prev) => [next, ...prev]);
        return next;
      },
      cancelBooking: (id) => {
        setBookings((prev) => prev.map((booking) => (booking.id === id ? { ...booking, status: "cancelled" } : booking)));
      },
    }),
    [bookings],
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