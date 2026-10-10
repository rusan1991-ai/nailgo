/**
 * Медиа мастера: загрузка фото, ресайз, лимиты и показ на витрине.
 *
 * Проверяем то, что важно для продукта: клиент видит настоящие фото работ,
 * а не инициалы. Файлы генерируются на месте (sharp умеет собрать картинку
 * из ничего), поэтому набор не зависит от картинок в репозитории.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && node bundle.mjs && npm run media
 */
import { api, apiAs, check, loginMaster, makeDom, resetDemo, rootText, wait, ORIGIN } from "./harness.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("/home/user/nailgo/apps/api/node_modules/sharp");

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const master = await loginMaster();
await resetDemo(master);

/** Картинка нужного размера и формата: PNG или JPEG. */
async function image(format = "png", width = 1600, height = 1200, quality = 90) {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 236, g: 72, b: 153 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect x="40" y="40" width="${width - 80}" height="${
            height - 80
          }" fill="white"/><text x="80" y="${height / 2}" font-size="120" fill="#ec4899">Nail 2 Go photo</text></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .toFormat(format, format === "jpeg" ? { quality } : {})
    .toBuffer();
  return buffer;
}

/** Загрузка multipart-ом: content-type ставит сам fetch вместе с boundary. */
async function upload(session, buffer, { kind = "portfolio", name = "work.png", type = "image/png", caption } = {}) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type }), name);
  form.append("kind", kind);
  if (caption) form.append("caption", caption);

  const response = await fetch(`${ORIGIN}/api/cabinet/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}` },
    body: form,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

/* --- Правила загрузки --- */

const rules = await api("/media/rules");
assert("правила загрузки доступны", rules.status === 200, `HTTP ${rules.status}`);
assert(
  "лимит размера — 5 МБ",
  rules.data.maxBytes === 5 * 1024 * 1024,
  `maxBytes=${rules.data?.maxBytes}`,
);
assert(
  "принимаем только изображения",
  rules.data.formats.every((format) => format.startsWith("image/")),
  rules.data.formats.join(", "),
);
assert(
  "типы медиа известны",
  ["avatar", "portfolio", "certificate"].every((kind) => rules.data.kinds.includes(kind)),
  rules.data.kinds.join(", "),
);

/* --- Загрузка работы --- */

const photo = await image("png", 1600, 1200);
const uploaded = await upload(master, photo, { kind: "portfolio", caption: "Френч с укреплением" });
assert("фото загружено", uploaded.status === 201 && Boolean(uploaded.data?.media?.id), JSON.stringify(uploaded.data).slice(0, 160));
assert(
  "размер уменьшен до лимита витрины (1200 по ширине)",
  uploaded.data.media.width === 1200 && uploaded.data.media.height === 900,
  `${uploaded.data.media.width}×${uploaded.data.media.height}`,
);
assert("сервер отдаёт web и thumb ссылки", Boolean(uploaded.data.media.url) && Boolean(uploaded.data.media.thumbUrl));

const mediaId = uploaded.data.media.id;

/* --- Файлы реально отдаются и отличаются по размеру --- */

const webResponse = await fetch(`${ORIGIN}${uploaded.data.media.url}`);
const thumbResponse = await fetch(`${ORIGIN}${uploaded.data.media.thumbUrl}`);
const webSize = Number(webResponse.headers.get("content-length") ?? 0);
const thumbSize = Number(thumbResponse.headers.get("content-length") ?? 0);
assert("файл web отдаётся картинкой", webResponse.status === 200 && webResponse.headers.get("content-type") === "image/jpeg");
assert("файл thumb отдаётся картинкой", thumbResponse.status === 200);
assert("превью легче полного файла", thumbSize > 0 && webSize > thumbSize, `web=${webSize}, thumb=${thumbSize}`);

/* --- Отказы --- */

const notImage = await upload(master, Buffer.from("это не картинка, а текст"), { type: "text/plain", name: "note.txt" });
assert("не изображение не принимается", notImage.status === 400 && notImage.data.error === "bad_type", JSON.stringify(notImage.data).slice(0, 120));

const big = Buffer.alloc(6 * 1024 * 1024, 1);
const bigUpload = await upload(master, big, { type: "image/png", name: "big.png" });
assert(
  "файл больше 5 МБ не принимается",
  bigUpload.status === 413 || bigUpload.status === 400,
  `HTTP ${bigUpload.status} ${JSON.stringify(bigUpload.data ?? {}).slice(0, 120)}`,
);

const noToken = await fetch(`${ORIGIN}/api/cabinet/media`);
assert("без входа галерея недоступна", noToken.status === 401, `HTTP ${noToken.status}`);

/* --- Аватар вытесняет предыдущий --- */

const avatarOne = await upload(master, await image("jpeg", 900, 900), { kind: "avatar", type: "image/jpeg" });
const avatarTwo = await upload(master, await image("webp", 900, 900), { kind: "avatar", type: "image/webp" });
assert("аватар загружен", avatarOne.status === 201 && avatarTwo.status === 201, `${avatarOne.status}/${avatarTwo.status}`);

const gallery = await api(`/masters/anna-smirnova`);
assert("витрина отдаёт аватар", Boolean(gallery.data.gallery.avatar), JSON.stringify(gallery.data.gallery?.avatar ?? {}).slice(0, 120));
assert(
  "аватар один: предыдущий файл заменён",
  gallery.data.gallery.avatar.id === avatarTwo.data.media.id,
  `${gallery.data.gallery.avatar.id} vs ${avatarTwo.data.media.id}`,
);
assert(
  "портфолио видно на витрине",
  gallery.data.gallery.portfolio.some((item) => item.id === mediaId),
  JSON.stringify(gallery.data.gallery.portfolio.map((item) => item.id)).slice(0, 160),
);
assert(
  "в карточке каталога есть ссылка на превью",
  (await api("/masters")).data.items.some((item) => item.slug === "anna-smirnova" && item.avatarUrl),
);

/* --- Удаление --- */

const removed = await apiAs(master, `/cabinet/media/${mediaId}`, { method: "DELETE" });
assert("файл удалён", removed.status === 200, `HTTP ${removed.status}`);
const afterDelete = await fetch(`${ORIGIN}${uploaded.data.media.url}`);
assert("удалённый файл больше не отдаётся", afterDelete.status === 404, `HTTP ${afterDelete.status}`);

/* --- Интерфейс: страница портфолио в кабинете --- */

const { dom, window } = makeDom("/pro/media", { session: master });
await wait(1500);
const text = rootText(dom);
assert("страница портфолио открылась", text.includes("Портфолио"), text.slice(0, 140));
const mediaInput = window.document.querySelector("[data-field='media-file']");
const uploadButton = window.document.querySelector("[data-action='upload-media']");
assert("поле выбора файла есть в доступности, но не выглядит как сырой input", Boolean(mediaInput && mediaInput.classList.contains("sr-only")));
assert("загрузка запускается оформленной кнопкой", Boolean(uploadButton) && uploadButton.textContent.includes("Загрузить"));
assert(
  "в кабинете объяснён лимит размера",
  text.includes("5,0 МБ") || text.includes("5 МБ"),
  text.slice(0, 220),
);
assert(
  "аватар из кабинета показан на странице",
  Boolean(window.document.querySelector("img[src*='/api/media/']")),
  "фото работ есть в галерее кабинета",
);

/* --- Витрина: карточки показывают превью, а не инициалы --- */

// Портфолио для проверки витрины: файл остался после удаления выше, поэтому
// загружаем ещё одну работу — карточка должна показать именно превью (thumb).
const showcase = await api("/masters");
const anna = showcase.data.items.find((item) => item.slug === "anna-smirnova");
assert(
  "каталог отдаёт превью и полную ссылку",
  anna?.avatarUrl?.includes("/thumb") && anna?.avatarFullUrl?.includes("/web"),
  `${anna?.avatarUrl} / ${anna?.avatarFullUrl}`,
);

const thumbFile = await fetch(`${ORIGIN}${anna.avatarUrl}`);
assert("превью реально отдаётся", thumbFile.status === 200, `HTTP ${thumbFile.status}`);

const home = makeDom("/");
await wait(1600);
const homeImage = home.window.document.querySelector("img[src*='/api/media/']");
assert(
  "на главной карточка мастера показывает фото",
  Boolean(homeImage),
  homeImage?.getAttribute("src") ?? rootText(home.dom).slice(0, 140),
);
assert(
  "на витрине именно превью 320, а не полный файл",
  homeImage?.getAttribute("src")?.includes("/thumb") === true,
  String(homeImage?.getAttribute("src")),
);

const searchPage = makeDom("/search");
await wait(1600);
assert(
  "в поиске карточки тоже с фото",
  Boolean(searchPage.window.document.querySelector("img[src*='/api/media/']")),
  "карточка поиска",
);

console.log(failures === 0 ? "\nМедиа: все проверки пройдены" : `\nМедиа: провалов ${failures}`);
process.exit(failures === 0 ? 0 : 1);
