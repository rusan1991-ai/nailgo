/** Запросы кабинета мастера: доступны только владельцу кабинета (роль master). */
import { useEffect, useState } from "react";
import { api } from "./client";

export type CabinetStats = {
  todayISO: string;
  /** Месяц, за который посчитаны цифры: «2024-05». */
  monthISO: string;
  bookingsToday: number;
  bookingsThisMonth: number;
  bookingsPrevMonth: number;
  incomeThisMonth: number;
  incomeDeltaLabel: string;
  newClientsThisMonth: number;
  clientsTotal: number;
  totalBookings: number;
  cancelled: number;
  avgCheckThisMonth: number;
  clientsThisMonth: number;
  repeatClientsThisMonth: number;
  /** Топ услуг месяца по выручке. */
  topServices: { name: string; bookings: number; revenue: number }[];
  byStatus: { pending: number; confirmed: number; completed: number; cancelled: number };
  bySource: { client: number; master: number };
  /** Дни месяца: график «Записи по дням». */
  byDay: { dateISO: string; label: string; bookings: number; revenue: number }[];
};

export type CabinetClient = {
  name: string;
  phone: string;
  visits: number;
  lastVisitISO: string;
  avgCheck: number;
  totalSpent: number;
  lastService: string;
  masterName: string;
  cancelled: number;
  /** Чем чаще приходил клиент: онлайн-записью или через кабинет. */
  source: "client" | "master";
};

type State<T> = { data: T | null; loading: boolean; error: string | null };

function useApiResource<T>(path: string | null): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: Boolean(path), error: null });

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState((current) => ({ ...current, loading: true }));
    void (async () => {
      try {
        const data = await api.get<T>(path);
        if (alive) setState({ data, loading: false, error: null });
      } catch (error) {
        if (alive) {
          setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Ошибка запроса" });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  return state;
}

/** Сводка кабинета. `month` в формате YYYY-MM — иначе берётся текущий месяц. */
export function useCabinetStats(month?: string): State<CabinetStats> {
  return useApiResource<CabinetStats>(`/cabinet/stats${month ? `?month=${month}` : ""}`);
}

export function useCabinetClients(): State<{ items: CabinetClient[]; total: number }> {
  return useApiResource<{ items: CabinetClient[]; total: number }>("/cabinet/clients");
}
