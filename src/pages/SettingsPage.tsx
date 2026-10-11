/**
 * Настройки клиента: имя, уведомления, удаление аккаунта.
 *
 * Всё сохраняется в базу: переключатели — сразу при переключении (выключенная
 * категория перестаёт приходить), имя — по кнопке. Удаление аккаунта требует
 * написать «УДАЛИТЬ»: оно необратимо, будущие записи отменяются.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, BellRing, Check, Mail } from "lucide-react";
import { ClientShell } from "../components/ClientShell";
import { LoginMethodsCard } from "../components/MessengerBanner";
import { useAuth } from "../auth/AuthContext";
import {
  deleteClientAccount,
  memberSince,
  saveClientName,
  saveClientSettings,
  useClientProfile,
  type ClientSettings,
} from "../api/clientProfile";
import { cn } from "../utils/cn";

function Toggle({
  on,
  onChange,
  label,
  action,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  action: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-action={action}
      data-on={on ? "true" : "false"}
      onClick={() => onChange(!on)}
      className={cn("h-7 w-12 rounded-full p-1 transition", on ? "bg-pink-500" : "bg-slate-300")}
    >
      <span className={cn("block h-5 w-5 rounded-full bg-white transition", on && "translate-x-5")} />
    </button>
  );
}

export function SettingsPage() {
  const { user, signOut, updateUser } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useClientProfile(Boolean(user));

  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const profile = data?.profile;

  // Профиль приехал — подставляем в форму (и когда меняется номер).
  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setSettings(profile.settings);
    setSavedName(null);
  }, [profile?.id, profile?.name, profile?.settings.notifyBookings, profile?.settings.notifyNews]);

  if (!user) {
    return (
      <ClientShell title="Настройки">
        <p className="rounded-2xl border border-dashed border-[#f1dde6] p-5 text-sm text-slate-500">
          Войдите, чтобы менять настройки: они хранятся в вашем аккаунте.
        </p>
      </ClientShell>
    );
  }

  const submitName = async () => {
    setNameError(null);
    setSavedName(null);
    try {
      const updated = await saveClientName(name);
      setSavedName(updated.name);
      updateUser({ name: updated.name });
    } catch (caught) {
      setNameError(caught instanceof Error ? caught.message : "Не удалось сохранить имя");
    }
  };

  const toggle = async (key: keyof ClientSettings) => {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setSettingsError(null);
    try {
      const saved = await saveClientSettings({ [key]: next[key] });
      setSettings(saved);
    } catch (caught) {
      setSettings(settings);
      setSettingsError(caught instanceof Error ? caught.message : "Не удалось сохранить настройку");
    }
  };

  const removeAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteClientAccount();
      signOut();
      navigate("/", { replace: true });
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Не удалось удалить аккаунт");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ClientShell title="Настройки">
      <div className="max-w-2xl space-y-3" data-page="settings">
        {loading && !profile && <p className="text-sm text-slate-500">Загружаем профиль…</p>}
        {error && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            Не удалось загрузить профиль: {error}
          </p>
        )}

        {/* Вход и уведомления: SMS не отправляем, напоминания идут в мессенджер. */}
        <LoginMethodsCard />

        <article className="rounded-2xl border border-[#f1dde6] p-4">
          <p className="font-medium">Имя</p>
          <p className="mt-1 text-sm text-slate-500">
            Так вас видят мастера в записях и переписке. Телефон {profile?.phone ?? user.phone ?? "не указан"} —
            просто контакт для связи: его можно изменить или убрать, вход от этого не зависит.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-field="client-name"
              className="w-full min-w-0 flex-1 rounded-xl border border-[#f1dde6] px-3 py-2 text-sm outline-none focus:border-pink-300 md:w-auto"
              placeholder="Ваше имя"
            />
            <button
              type="button"
              onClick={submitName}
              disabled={name.trim().length < 2 || name === profile?.name}
              data-action="save-name"
              className="rounded-xl bg-[#e11d48] px-4 py-2 text-sm font-medium text-white disabled:bg-slate-200 disabled:text-slate-400"
            >
              Сохранить
            </button>
          </div>
          {savedName && (
            <p className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-600">
              <Check className="h-4 w-4" /> Имя сохранено: {savedName}
            </p>
          )}
          {nameError && <p className="mt-2 text-sm text-rose-600">{nameError}</p>}
          {profile && (
            <p className="mt-2 text-xs text-slate-400">
              С нами с {memberSince(profile.createdAt)}
            </p>
          )}
        </article>

        <article className="rounded-2xl border border-[#f1dde6] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 font-medium">
                <BellRing className="h-4 w-4 text-slate-400" /> Уведомления о записи
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Подтверждение, перенос, отмена визита и ответы мастера на отзывы —
                и в приложении, и SMS на телефон.
              </p>
            </div>
            <Toggle
              on={settings?.notifyBookings ?? true}
              onChange={() => void toggle("notifyBookings")}
              label="Уведомления о записи"
              action="toggle-bookings"
            />
          </div>
        </article>

        <article className="rounded-2xl border border-[#f1dde6] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 font-medium">
                <Mail className="h-4 w-4 text-slate-400" /> Акции и свободные окна
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Сообщения вроде «у избранного мастера освободилось окно»: в приложении и SMS.
              </p>
            </div>
            <Toggle
              on={settings?.notifyNews ?? true}
              onChange={() => void toggle("notifyNews")}
              label="Акции и свободные окна"
              action="toggle-news"
            />
          </div>
          {settingsError && <p className="mt-2 text-sm text-rose-600">{settingsError}</p>}
          <button
            type="button"
            onClick={reload}
            className="mt-3 text-xs text-slate-400 hover:text-slate-600"
          >
            Обновить из базы
          </button>
        </article>

        <article className="rounded-2xl border border-[#f1dde6] p-4 text-sm text-slate-600">
          <p>Язык: Русский</p>
          <p className="mt-2">Валюта: ₽ RUB</p>
          <p className="mt-2 text-xs text-slate-400">
            Остальные настройки появятся вместе с SMS и push-доставкой.
          </p>
        </article>

        <article className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4" data-block="danger">
          <p className="inline-flex items-center gap-2 font-medium text-rose-700">
            <AlertTriangle className="h-4 w-4" /> Удаление аккаунта
          </p>
          <p className="mt-1 text-sm text-rose-700/80">
            Будущие записи отменятся, избранное и переписка удалятся, история визитов у мастеров останется
            обезличенной. Вернуть аккаунт нельзя — вход по этому номеру создаст новый.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              data-field="delete-confirm"
              placeholder="Напишите УДАЛИТЬ"
              className="w-full min-w-0 flex-1 rounded-xl border border-rose-200 px-3 py-2 text-sm outline-none focus:border-rose-400 md:w-auto"
            />
            <button
              type="button"
              onClick={removeAccount}
              disabled={confirmText.trim().toUpperCase() !== "УДАЛИТЬ" || deleting}
              data-action="delete-account"
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:bg-rose-200"
            >
              {deleting ? "Удаляем…" : "Удалить аккаунт"}
            </button>
          </div>
          {deleteError && <p className="mt-2 text-sm text-rose-700">{deleteError}</p>}
        </article>
      </div>
    </ClientShell>
  );
}
