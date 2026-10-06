import { useState } from "react";
import { Camera, Download, Save, Trash2, Upload } from "lucide-react";
import {
  Card,
  CardTitle,
  PersonAvatar,
  PrimaryButton,
  Select,
  TextArea,
  TextField,
  Toggle,
} from "../components/ui";
import { settingsNav, masterProfile } from "../data";
import { cn } from "../../utils/cn";

export function SettingsProPage() {
  const [section, setSection] = useState("profile");
  const [name, setName] = useState(masterProfile.name);
  const [phone, setPhone] = useState(masterProfile.phone);
  const [email, setEmail] = useState(masterProfile.email);
  const [address, setAddress] = useState(masterProfile.address);
  const [site, setSite] = useState(masterProfile.site);
  const [description, setDescription] = useState(masterProfile.description);
  const [timezone, setTimezone] = useState(masterProfile.timezone);
  const [language, setLanguage] = useState(masterProfile.language);

  const [notifyNew, setNotifyNew] = useState(true);
  const [notifyReminders, setNotifyReminders] = useState(true);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifyMarketing, setNotifyMarketing] = useState(false);

  const [dateFormat, setDateFormat] = useState("DD.MM.YYYY");
  const [timeFormat, setTimeFormat] = useState("24 часа (14:30)");
  const [gap, setGap] = useState("15 минут");
  const [minDuration, setMinDuration] = useState("15 минут");
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [saved, setSaved] = useState(false);

  const sectionTitle = settingsNav
    .flatMap((group) => group.items)
    .find((item) => item.id === section)?.label;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Настройки</h1>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-600">Сохранено</span>}
          <PrimaryButton onClick={() => setSaved(true)}>
            <Save className="h-4 w-4" />
            Сохранить изменения
          </PrimaryButton>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        <Card className="h-fit" padded={false}>
          <nav className="p-3">
            {settingsNav.map((group) => (
              <div key={group.title} className="mb-3 last:mb-0">
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {group.title}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSection(item.id)}
                        className={cn(
                          "w-full rounded-xl px-3 py-2 text-left text-sm transition",
                          item.id === section
                            ? "bg-rose-50 font-medium text-[#e11d48]"
                            : "text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </Card>

        <div className="space-y-4">
          {section === "profile" ? (
            <>
              <Card>
                <CardTitle>Профиль и бизнес</CardTitle>

                <div className="grid gap-5 sm:grid-cols-[110px_1fr]">
                  <div className="space-y-3">
                    <div className="relative w-fit">
                      <PersonAvatar name={name} size={92} />
                      <button className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm">
                        <Camera className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Имя мастера / название студии" value={name} onChange={setName} />
                    <TextField label="Телефон" value={phone} onChange={setPhone} />
                    <div className="sm:col-span-2">
                      <TextArea label="Описание" value={description} onChange={setDescription} rows={4} />
                    </div>
                    <TextField label="Email" value={email} onChange={setEmail} />
                    <TextField label="Адрес (необязательно)" value={address} onChange={setAddress} />
                    <TextField label="Сайт (необязательно)" value={site} onChange={setSite} />
                    <div>
                      <p className="text-xs font-medium text-slate-500">Логотип / фото студии</p>
                      <div className="mt-1.5 flex items-center gap-4">
                        <span className="grid h-20 w-20 place-items-center rounded-xl bg-rose-50 text-center text-xs font-semibold uppercase tracking-wide text-rose-400">
                          Nail
                          <br />
                          studio
                        </span>
                        <button className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-600 transition hover:bg-slate-50">
                          <Upload className="h-4 w-4" />
                          Загрузить фото
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">Рекомендуемый размер: 512×512px, JPG или PNG</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <CardTitle>Часовой пояс</CardTitle>
                <Select
                  value={timezone}
                  onChange={setTimezone}
                  options={[
                    { value: "(GMT+3) Москва, Санкт-Петербург", label: "(GMT+3) Москва, Санкт-Петербург" },
                    { value: "(GMT+2) Калининград", label: "(GMT+2) Калининград" },
                    { value: "(GMT+5) Екатеринбург", label: "(GMT+5) Екатеринбург" },
                  ]}
                />
                <p className="mt-2 text-xs text-slate-400">
                  Время в системе и расписании будет отображаться в выбранном часовом поясе.
                </p>
              </Card>

              <Card>
                <CardTitle>Язык интерфейса</CardTitle>
                <Select
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: "Русский", label: "Русский" },
                    { value: "English", label: "English" },
                  ]}
                />
              </Card>

              <Card>
                <CardTitle>Удаление аккаунта</CardTitle>
                <p className="text-sm text-slate-500">Все данные будут удалены без возможности восстановления.</p>
                <button className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-medium text-[#e11d48] transition hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" />
                  Удалить аккаунт
                </button>
              </Card>
            </>
          ) : (
            <Card>
              <CardTitle>{sectionTitle}</CardTitle>
              <p className="text-sm text-slate-500">
                Раздел появится в следующей версии кабинета. Профиль, уведомления, форматы и параметры записи уже
                работают справа.
              </p>
              <button
                type="button"
                onClick={() => setSection("profile")}
                className="mt-4 text-sm font-medium text-[#e11d48]"
              >
                ← Вернуться к профилю
              </button>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>Уведомления</CardTitle>
            <div className="divide-y divide-slate-50">
              <Toggle
                checked={notifyNew}
                onChange={setNotifyNew}
                label="Уведомления о новых записях"
              />
              <Toggle
                checked={notifyReminders}
                onChange={setNotifyReminders}
                label="Напоминания клиентам"
              />
              <Toggle
                checked={notifyWhatsapp}
                onChange={setNotifyWhatsapp}
                label="Уведомления в WhatsApp"
              />
              <Toggle checked={notifyEmail} onChange={setNotifyEmail} label="Email-уведомления" />
              <Toggle
                checked={notifyMarketing}
                onChange={setNotifyMarketing}
                label="Маркетинговые рассылки"
              />
            </div>
          </Card>

          <Card>
            <CardTitle>Формат даты и времени</CardTitle>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Формат даты</p>
                <Select
                  value={dateFormat}
                  onChange={setDateFormat}
                  options={[
                    { value: "DD.MM.YYYY", label: "DD.MM.YYYY" },
                    { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
                  ]}
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Формат времени</p>
                <Select
                  value={timeFormat}
                  onChange={setTimeFormat}
                  options={[
                    { value: "24 часа (14:30)", label: "24 часа (14:30)" },
                    { value: "12 часов (2:30 PM)", label: "12 часов (2:30 PM)" },
                  ]}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Параметры записи</CardTitle>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Интервал между записями</p>
                <Select
                  value={gap}
                  onChange={setGap}
                  options={[
                    { value: "15 минут", label: "15 минут" },
                    { value: "30 минут", label: "30 минут" },
                    { value: "Без интервала", label: "Без интервала" },
                  ]}
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Минимальная длительность услуги</p>
                <Select
                  value={minDuration}
                  onChange={setMinDuration}
                  options={[
                    { value: "15 минут", label: "15 минут" },
                    { value: "30 минут", label: "30 минут" },
                  ]}
                />
              </div>
              <Toggle
                checked={onlyAvailable}
                onChange={setOnlyAvailable}
                label="Показывать только доступное время"
              />
            </div>
          </Card>

          <Card>
            <CardTitle>Резервное копирование</CardTitle>
            <p className="text-sm text-slate-500">Экспортируйте данные студии и клиентов.</p>
            <button className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50">
              <Download className="h-4 w-4" />
              Экспорт данных
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}
