/**
 * Личный кабинет клиента: профиль, настройки уведомлений, удаление аккаунта.
 *
 * Клиента опознаём по телефону из сессии — номер в запросе ничего не решает.
 * Мастер тоже может править это (у него тоже есть телефон), но кабинет мастера
 * живёт отдельно в `/cabinet/*`.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../lib/auth.js";
import {
  clientProfile,
  deleteClientAccount,
  updateClientName,
  updateClientSettings,
} from "../lib/account.js";

const nameSchema = z.object({ name: z.string().trim().min(2, "Укажите имя").max(80) });
const settingsSchema = z
  .object({
    notifyBookings: z.boolean().optional(),
    notifyNews: z.boolean().optional(),
  })
  .refine((value) => value.notifyBookings !== undefined || value.notifyNews !== undefined, {
    message: "Нужен хотя бы один переключатель",
  });
const deleteSchema = z.object({
  // Подтверждение словом: удаление необратимо, случайное нажатие не должно его запускать.
  confirm: z.literal("УДАЛИТЬ"),
});

export async function clientRoutes(app: FastifyInstance) {
  /** Профиль клиента: имя, телефон и текущие настройки. */
  app.get("/client/profile", { preHandler: requireAuth }, async (request, reply) => {
    const profile = await clientProfile(request.currentUser!.phone);
    if (!profile) return reply.code(404).send({ error: "not_found", message: "Профиль не найден" });
    return { profile };
  });

  /** Правка имени: оно же показывается мастеру в записях. */
  app.patch("/client/profile", { preHandler: requireAuth }, async (request, reply) => {
    const { name } = nameSchema.parse(request.body ?? {});
    const updated = await updateClientName(request.currentUser!.phone, name);
    if (!updated) return reply.code(404).send({ error: "not_found", message: "Профиль не найден" });

    const profile = await clientProfile(request.currentUser!.phone);
    return { ok: true, user: { name: updated }, profile };
  });

  /** Переключатели уведомлений: выключенная категория перестаёт приходить. */
  app.patch("/client/settings", { preHandler: requireAuth }, async (request, reply) => {
    const patch = settingsSchema.parse(request.body ?? {});
    const settings = await updateClientSettings(request.currentUser!.phone, patch);
    if (!settings) return reply.code(404).send({ error: "not_found", message: "Профиль не найден" });
    return { ok: true, settings };
  });

  /**
   * Удаление аккаунта: личные данные уходят, история визитов мастера остаётся
   * обезличенной. Будущие записи отменяются — приходить по ним некому.
   */
  app.delete("/client/account", { preHandler: requireAuth }, async (request, reply) => {
    deleteSchema.parse(request.body ?? {});
    const removed = await deleteClientAccount(request.currentUser!.phone);
    if (!removed) return reply.code(404).send({ error: "not_found", message: "Профиль не найден" });

    return { ok: true, removed };
  });
}
