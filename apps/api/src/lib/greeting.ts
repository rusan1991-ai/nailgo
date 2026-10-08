/**
 * Приветственное сообщение клиенту после ручной записи.
 *
 * Мастер записал человека вручную — тот ещё ничего не знает о Nail 2 Go.
 * Поэтому запись заканчивается дружелюбным сообщением: когда визит, к кому,
 * куда идти и ссылка на личный кабинет в один клик (без пароля).
 *
 * Текст собирается **на сервере**: его же отправляет бот, если у человека уже
 * привязан Telegram или Max, и его же показывают кнопки шаринга в кабинете.
 * Один шаблон — одно сообщение, чем бы его ни отправили.
 */
import { env } from "../env.js";
import { normalizePhone } from "./phone.js";

/** Название маркетплейса для интерфейсов и сообщений. */
export const BRAND = "Nail 2 Go";

/** Мессенджеры, которыми мастер может поделиться ссылкой. */
export type ShareMessenger = "whatsapp" | "telegram" | "max";

export const SHARE_MESSENGERS: ShareMessenger[] = ["whatsapp", "telegram", "max"];

/** Плейсхолдер в очереди доставки: реальный токен достаётся только при отправке. */
export const MAGIC_LINK_PLACEHOLDER = "[[N2G_MAGIC_LINK]]";

export const MESSENGER_LABELS: Record<ShareMessenger, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  max: "Max",
};

export function isShareMessenger(value: unknown): value is ShareMessenger {
  return typeof value === "string" && (SHARE_MESSENGERS as string[]).includes(value);
}

/**
 * Ссылка входа по «магии»: `nail2go.ru/login?magic=TOKEN`.
 * Токен одноразовый, поэтому ссылку можно смело отправлять в мессенджер.
 */
export function magicLoginUrl(token: string): string {
  return `${env.publicWebUrl}/login?magic=${encodeURIComponent(token)}`;
}

/** Обращение по имени: «Ольга Петрова» → «Ольга» — так теплее и короче. */
export function firstName(fullName: string): string {
  const [first] = fullName.trim().split(/\s+/);
  return first && first.length > 0 ? first : fullName.trim();
}

export type GreetingInput = {
  clientName: string;
  masterName: string;
  serviceName: string;
  dateLabel: string;
  timeLabel: string;
  address: string | null;
  /** Полная ссылка входа (`magicLoginUrl`). */
  link: string;
};

/**
 * Шаблон сообщения. Эмодзи и «ты» — осознанные: сообщение приходит от мастера
 * лично, а не от сервисной рассылки, и должно читаться как забота, а не как
 * автоматическое уведомление.
 */
export function greetingText(input: GreetingInput): string {
  const where = input.address ? `по адресу: ${input.address}` : "адрес уточнит мастер";
  return [
    `Привет, ${firstName(input.clientName)}! 🌸 Мастер ${input.masterName} записала тебя на ${input.serviceName} 🥰`,
    `Ждём тебя ${input.dateLabel} в ${input.timeLabel}, ${where} 📍`,
    `Твой личный кабинет на ${BRAND} уже готов! Ты можешь проверить детали записи, перенести время или посмотреть другие работы мастера в один клик без всяких паролей. Просто тыкай сюда:`,
    `👉 ${input.link}`,
    "До встречи на процедуре! ✨",
  ].join("\n");
}

export type ShareLinks = {
  /** `https://wa.me/<номер>?text=…` — открывает чат с клиентом и подставляет текст. */
  whatsapp: string;
  /** `https://t.me/share/url?url=…&text=…` — нативный шаринг в Telegram. */
  telegram: string;
  /** Диплинк в приложение Max: текст мастеру нужно скопировать (кнопка в кабинете). */
  max: string;
};

/**
 * Ссылки «поделиться» для кнопок кабинета.
 *
 * WhatsApp и Telegram умеют принимать готовый текст ссылкой — мастер жмёт
 * кнопку и попадает в чат с уже заполненным сообщением. У Max публичного
 * шаринга нет: там диплинк открывает приложение, а текст кладётся в буфер
 * обмена (это делает интерфейс).
 */
export function shareLinks(input: { phone: string | null; text: string }): ShareLinks {
  const digits = input.phone ? normalizePhone(input.phone).replace(/\D/g, "") : "";
  const magicUrl = input.text.match(/https?:\/\/[^\s]+/)?.[0] ?? "";
  const telegramMessage = magicUrl ? input.text.replace(magicUrl, "").trim() : input.text;
  return {
    whatsapp: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(input.text)}` : `https://wa.me/?text=${encodeURIComponent(input.text)}`,
    // Telegram share принимает ссылку отдельно от текста — так сообщение не
    // дублирует magic URL, но ссылка остаётся кликабельной.
    telegram: `https://t.me/share/url?url=${encodeURIComponent(magicUrl)}&text=${encodeURIComponent(telegramMessage)}`,
    max: env.maxAppUrl,
  };
}

/** Причина, по которой сообщение ушло не в мессенджер, а в журнал системы. */
export const NO_CHANNEL_LABEL = "журнал системы";
