/**
 * Ошибки бизнес-логики.
 *
 * Живут отдельно от маршрутов, чтобы модули вроде автомата статусов могли их
 * бросать, не завися от `routes/`. Обработчик в `server.ts` превращает такую
 * ошибку в ответ с нужным кодом и `error`-меткой.
 */
export class BookingError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Коды-метки для проверок и фронтенда (одинаковые во всех ручках). */
export const ERROR_CODES = {
  slotTaken: "slot_taken",
  pastSlot: "past_slot",
  dayOff: "day_off",
  outsideWorkingHours: "outside_working_hours",
  badTransition: "bad_transition",
  blacklisted: "blacklisted",
  tooManyAttempts: "too_many_attempts",
  otpRateLimited: "otp_rate_limited",
} as const;
