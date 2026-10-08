/**
 * Лимиты входа в админке.
 *
 * Код по телефону — инструмент стенда, но лимиты на него настоящие: они
 * защищают от перебора и спама. Здесь видно, сколько обращений накопилось в
 * текущем скользящем окне, какое значение действует (окружение или админка) и
 * можно снять счётчики — например, когда живой клиент упёрся в лимит из-за
 * нескольких попыток подряд.
 */
import { useEffect, useState } from "react";
import { Card, CardTitle, Chip, PageHeader, PrimaryButton } from "../../master/components/ui";
import { resetRateLimits, saveRateLimit, useAdminLimits, type AdminLimit } from "../../api/admin";
import { cn } from "../../utils/cn";

/** Человеческие подписи лимитов: ключи в базе — служебные. */
const labels: Record<string, { title: string; hint: string; scope: "phone" | "ip" | "verify" }> = {
  "otp.request.perPhone": {
    title: "Отправка кода на номер",
    hint: "Сколько кодов можно запросить на один номер в окне",
    scope: "phone",
  },
  "otp.request.perIp": {
    title: "Отправка кода с адреса",
    hint: "Защита от перебора номеров с одного IP",
    scope: "ip",
  },
  "otp.verify.perPhone": {
    title: "Ввод кода на номер",
    hint: "Сколько раз можно ошибиться с кодом за окно",
    scope: "verify",
  },
};

const windowLabel = (seconds: number) => {
  if (seconds % 3600 === 0) return `${seconds / 3600} ч`;
  if (seconds % 60 === 0) return `${seconds / 60} мин`;
  return `${seconds} с`;
};

export function AdminLimitsPage() {
  const { data, loading, error, reload } = useAdminLimits();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // Значения из базы подставляем в поля один раз, дальше человек правит сам.
  useEffect(() => {
    if (!data) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const item of data.items) {
        if (next[item.key] === undefined) next[item.key] = String(item.effective);
      }
      return next;
    });
  }, [data]);

  const clear = async (scope: "all" | "phone" | "ip" | "verify") => {
    setBusy(scope);
    setActionError(null);
    try {
      const result = await resetRateLimits(scope);
      setNotice(
        scope === "all"
          ? `Счётчики окна сняты: ${result.cleared} записей`
          : `Счётчики сняты: ${result.cleared} записей`,
      );
      reload();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Не удалось снять счётчики");
    } finally {
      setBusy(null);
    }
  };

  const applyValue = async (item: AdminLimit, value: string) => {
    setBusy(item.key);
    setActionError(null);
    try {
      // Пустая строка — вернуться к значению из окружения.
      const parsed = value.trim() === "" ? null : Number.parseInt(value, 10);
      if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) {
        setActionError("Лимит — целое число от 0 (0 выключает проверку) или пустое поле для значения из окружения");
        return;
      }
      await saveRateLimit(item.key, parsed);
      setNotice(parsed === null ? "Вернулись к значению из окружения" : `Лимит сохранён: ${parsed}`);
      reload();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Не удалось сохранить лимит");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5" data-block="admin-limits">
      <PageHeader
        title="Лимиты входа"
        subtitle="Скользящее окно по коду из журнала: сколько запросов уже накопилось и что делать, если клиент упёрся"
        action={
          <PrimaryButton data-action="reset-all" onClick={() => void clear("all")} disabled={busy === "all"}>
            {busy === "all" ? "Снимаем…" : "Снять все счётчики"}
          </PrimaryButton>
        }
      />

      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}
      {actionError && <p className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-600">{actionError}</p>}
      {loading && <p className="text-sm text-slate-500">Загружаем лимиты…</p>}
      {error && <p className="text-sm text-rose-600">Не удалось загрузить лимиты: {error}</p>}

      {data && (
        <>
          <Card>
            <CardTitle action={<Chip tone="blue">окно {windowLabel(data.windowSeconds)}</Chip>}>
              Действующие лимиты
            </CardTitle>
            <div className="space-y-3">
              {data.items.map((item) => {
                const info = labels[item.key] ?? { title: item.key, hint: item.prefix, scope: "all" as const };
                const hitsPercent = item.effective > 0 ? Math.min(100, Math.round((item.hits / item.effective) * 100)) : null;
                return (
                  <div
                    key={item.key}
                    data-limit={item.key}
                    data-hits={item.hits}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-800">{info.title}</p>
                        <p className="text-xs text-slate-500">{info.hint}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
                          в окне: {item.hits}
                          {item.effective > 0 ? ` из ${item.effective}` : " (лимит выключен)"}
                        </span>
                        <button
                          type="button"
                          data-action={`reset-${info.scope}`}
                          onClick={() => void clear(info.scope)}
                          disabled={busy === info.scope}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Снять счётчики
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <label className="text-xs text-slate-500">
                        <span className="mb-1 block">Значение</span>
                        <input
                          value={drafts[item.key] ?? String(item.effective)}
                          onChange={(event) => setDrafts((current) => ({ ...current, [item.key]: event.target.value }))}
                          data-field={`limit-${item.key}`}
                          inputMode="numeric"
                          className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-pink-300"
                        />
                      </label>
                      <button
                        type="button"
                        data-action={`save-${item.key}`}
                        onClick={() => void applyValue(item, drafts[item.key] ?? "")}
                        disabled={busy === item.key}
                        className="rounded-xl bg-pink-500 px-3 py-2 text-sm font-medium text-white hover:bg-pink-600 disabled:opacity-60"
                      >
                        Сохранить
                      </button>
                      <p className="text-xs text-slate-400">
                        из окружения: {item.env}
                        {item.stored === null ? " · сейчас действует оно" : ` · в админке: ${item.stored}`}
                      </p>
                    </div>

                    {hitsPercent !== null && (
                      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn("h-full rounded-full", hitsPercent >= 80 ? "bg-rose-400" : "bg-pink-400")}
                          style={{ width: `${hitsPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardTitle>Что это за окно</CardTitle>
            <p className="text-sm text-slate-600">
              Каждое обращение за кодом и каждая попытка ввода записываются в <code className="rounded bg-slate-100 px-1">rate_limit_hits</code>{" "}
              и живут {windowLabel(data.windowSeconds)}. Счётчики снимаются сразу — клиенту не нужно ждать окно. Значение из админки
              перекрывает переменные окружения, пустое поле возвращает их обратно.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
