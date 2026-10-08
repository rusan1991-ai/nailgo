/**
 * Портфолио мастера: загрузка фото работ, аватар и сертификаты.
 *
 * Витрина показывает настоящие фотографии вместо инициалов, поэтому эта
 * страница — часть профиля, а не «дополнение». Сервер принимает только
 * изображения до 5 МБ и сам сжимает их в два размера: карточка каталога
 * получает лёгкий `thumb`, страница мастера — `web`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, mediaApi, type MasterMedia, type MediaKind, type MediaRules } from "../../api/media";

const KIND_LABELS: Record<MediaKind, string> = {
  avatar: "Аватар",
  portfolio: "Работа",
  certificate: "Сертификат",
};

export function MediaPage() {
  const [items, setItems] = useState<MasterMedia[]>([]);
  const [rules, setRules] = useState<MediaRules | null>(null);
  const [kind, setKind] = useState<MediaKind>("portfolio");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await mediaApi.gallery();
      setItems(response.items);
      setRules(response.rules);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить портфолио");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await mediaApi.upload(file, kind, caption.trim() || undefined);
      setNotice(`Фото «${file.name}» загружено`);
      setCaption("");
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить фото");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: MasterMedia) => {
    setBusy(true);
    try {
      await mediaApi.remove(item.id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить фото");
    } finally {
      setBusy(false);
    }
  };

  const avatar = items.find((item) => item.kind === "avatar") ?? null;
  const rest = items.filter((item) => item.kind !== "avatar");

  return (
    <div className="space-y-5" data-page="media">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Портфолио</h1>
        <p className="mt-1 text-sm text-slate-500">
          Клиенты выбирают мастера по работам: загрузите аватар и несколько фото. Пока фото нет, в карточке
          показывается заливка с первой буквой имени.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <label className="text-sm">
            <span className="text-slate-600">Тип файла</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as MediaKind)}
              data-field="media-kind"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {(rules?.kinds ?? ["portfolio", "avatar", "certificate"]).map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value as MediaKind]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-600">Подпись (необязательно)</span>
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              data-field="media-caption"
              placeholder="Например: френч с укреплением"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={(rules?.formats ?? ["image/jpeg", "image/png", "image/webp"]).join(",")}
            data-field="media-file"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
            className="text-sm"
          />
          <span className="text-xs text-slate-500">
            Только изображения, до {rules ? formatBytes(rules.maxBytes) : "5 МБ"}. Фото сжимается автоматически.
          </span>
        </div>

        {notice && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
        {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-800">Аватар</h2>
        {avatar ? (
          <div className="mt-3 flex items-center gap-4">
            <img src={avatar.thumbUrl} alt={avatar.caption ?? "Аватар мастера"} className="h-20 w-20 rounded-full object-cover" />
            <div className="text-sm text-slate-500">
              <p>
                {avatar.width}×{avatar.height}, {formatBytes(avatar.sizeBytes)}
              </p>
              <button
                type="button"
                onClick={() => void remove(avatar)}
                disabled={busy}
                data-action="delete-media"
                className="mt-2 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:border-rose-200 hover:text-rose-600"
              >
                Удалить
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Аватара нет. Загрузите фото в поле выше, выбрав тип «Аватар» — оно появится в каталоге и на вашей странице.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-slate-800">Работы и сертификаты</h2>
          <span className="text-xs text-slate-400">
            {rest.length}
            {rules ? ` / ${rules.maxPortfolio} работ` : ""}
          </span>
        </div>

        {rest.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Пока ничего не загружено.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {rest.map((item) => (
              <figure key={item.id} className="overflow-hidden rounded-2xl border border-slate-200">
                <img src={item.thumbUrl} alt={item.caption ?? "Фото работы"} className="h-40 w-full object-cover" />
                <figcaption className="space-y-2 p-3 text-xs text-slate-500">
                  <p className="font-medium text-slate-700">{KIND_LABELS[item.kind]}</p>
                  {item.caption && <p>{item.caption}</p>}
                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    disabled={busy}
                    data-action="delete-media"
                    className="rounded-lg border border-slate-200 px-2 py-1 hover:border-rose-200 hover:text-rose-600"
                  >
                    Удалить
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
