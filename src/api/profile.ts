/** Профиль кабинета и часы работы: чтение и сохранение в базе. */
import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import { useApiResource, type Resource } from "./resource";

export type CabinetProfile = {
  slug: string;
  name: string;
  phone: string;
  email: string;
  site: string;
  address: string;
  about: string;
  tags: string;
  metro: string;
  distance: string;
  priceFrom: number;
  experience: string;
  rating: number;
  reviewsCount: number;
  /** Пояс мастера: в нём считаются окна, расписание и тексты сообщений. */
  timezone: string;
  /** Свой шаг сетки слотов: 0 — общий шаг площадки. */
  slotStepMinutes: number;
  /** Пояс площадки: с ним сравнивается выбранный пояс. */
  platformTimezone: string;
  /** Решение площадки по профилю: active | paused | blocked. */
  status?: "active" | "paused" | "blocked";
  statusReason?: string | null;
  statusChangedAt?: string | null;
  /** Короткая ссылка мастера (`/any_nails`) или null, если не задана. */
  usernameSlug?: string | null;
  /** Куда ведёт публичная ссылка: короткая, если задана, иначе `/master/<slug>`. */
  publicPath?: string;
};

/** Пояса России для выбора в кабинете: запад → восток. */
export const MASTER_TIMEZONES: { value: string; label: string }[] = [
  { value: "Europe/Kaliningrad", label: "(UTC+2) Калининград" },
  { value: "Europe/Moscow", label: "(UTC+3) Москва, Санкт-Петербург" },
  { value: "Europe/Samara", label: "(UTC+4) Самара, Ижевск" },
  { value: "Asia/Yekaterinburg", label: "(UTC+5) Екатеринбург, Уфа" },
  { value: "Asia/Omsk", label: "(UTC+6) Омск" },
  { value: "Asia/Krasnoyarsk", label: "(UTC+7) Красноярск, Новосибирск" },
  { value: "Asia/Irkutsk", label: "(UTC+8) Иркутск, Улан-Удэ" },
  { value: "Asia/Yakutsk", label: "(UTC+9) Якутск, Чита" },
  { value: "Asia/Vladivostok", label: "(UTC+10) Владивосток, Хабаровск" },
  { value: "Asia/Magadan", label: "(UTC+11) Магадан, Сахалин" },
  { value: "Asia/Kamchatka", label: "(UTC+12) Камчатка" },
];

export type WorkDay = {
  weekday: number;
  label: string;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
};

export function useCabinetProfile(): Resource<{ profile: CabinetProfile }> {
  return useApiResource<{ profile: CabinetProfile }>("/cabinet/profile");
}

export function useCabinetHours(): Resource<{ items: WorkDay[] }> {
  return useApiResource<{ items: WorkDay[] }>("/cabinet/hours");
}

/** Сохранение профиля: пустые поля очищаем, цену передаём числом. */
export async function saveCabinetProfile(input: {
  name: string;
  email: string;
  site: string;
  address: string;
  about: string;
  tags: string;
  metro: string;
  experience: string;
  priceFrom: number;
  timezone?: string;
  slotStepMinutes?: number;
  /** Короткая ссылка: пустая строка снимает её (остаётся `/master/<slug>`). */
  usernameSlug?: string;
}): Promise<void> {
  await api.patch("/cabinet/profile", input);
}

/** Сохранение часов работы: сервер заменяет неделю целиком. */
export async function saveCabinetHours(items: WorkDay[]): Promise<void> {
  await api.put("/cabinet/hours", {
    items: items.map((item) => ({
      weekday: item.weekday,
      enabled: item.enabled,
      startMinute: item.startMinute,
      endMinute: item.endMinute,
    })),
  });
}

/** «09:00» ⇄ минуты от полуночи: формы работают со строками, API — с числами. */
export function minutesToLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function labelToMinutes(label: string): number {
  const [hours, minutes] = label.split(":").map((part) => Number.parseInt(part, 10));
  return (Number.isFinite(hours) ? hours! : 0) * 60 + (Number.isFinite(minutes) ? minutes! : 0);
}

/**
 * Локальная копия часов работы с сохранением: форма редактирует копию,
 * кнопка «Сохранить изменения» отправляет её на сервер.
 */
export function useHoursDraft(source: WorkDay[] | undefined) {
  const [draft, setDraft] = useState<WorkDay[] | null>(null);

  useEffect(() => {
    if (source) setDraft(source.map((item) => ({ ...item })));
  }, [source]);

  const update = useCallback((weekday: number, patch: Partial<WorkDay>) => {
    setDraft((current) =>
      current ? current.map((item) => (item.weekday === weekday ? { ...item, ...patch } : item)) : current,
    );
  }, []);

  return { draft, update, reset: () => setDraft(source ? source.map((item) => ({ ...item })) : null) };
}
