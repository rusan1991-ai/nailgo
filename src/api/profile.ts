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
};

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
