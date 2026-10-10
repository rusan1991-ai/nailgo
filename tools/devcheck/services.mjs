/**
 * Услуги и цены кабинета: CRUD на API и влияние прайса на запись.
 *
 * Проверяем, что мастер управляет только своими услугами, что скрытие убирает
 * услугу из каталога и окон, что длительность меняет расчёт слотов, а услугу
 * с записями нельзя удалить — её скрывают.
 *
 * Запуск (при живых Vite и API):
 *   cd tools/devcheck && npm run services
 */
import { api, apiAs, check, click, clickActionIn, login, loginMaster, makeDom, resetDemo, rootText, setField, wait, nextWorkingISO } from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const DATE = nextWorkingISO(0);
/**
 * Для сравнения окон по длительности нужен день с полным набором свободного
 * времени: вечером «сегодня» окон может не остаться вовсе, и сравнение
 * потеряет смысл. Берём ближайший рабочий день впереди.
 */
const SLOT_DATE = nextWorkingISO(1);
const master = await loginMaster();
await resetDemo(master);

/* --- API: прайс живёт в базе и принадлежит мастеру --- */
const own = await apiAs(master, "/cabinet/services");
assert("кабинет отдаёт прайс из базы", own.status === 200 && own.data.total === 10, `услуг=${own.data?.total}`);
assert(
  "услуги принадлежат мастеру",
  own.data.items.every((item) => item.id.startsWith("anna-smirnova-")),
  own.data.items[0]?.id,
);
assert(
  "счётчик записей по услуге посчитан",
  own.data.items.some((item) => item.bookingsCount > 0),
  "услуг с записями: " + own.data.items.filter((item) => item.bookingsCount > 0).length,
);

const publicAnna = await api("/services?master=anna-smirnova");
const publicMaria = await api("/services?master=maria-ivanova");
assert(
  "витрина отдаёт прайс конкретного мастера",
  publicAnna.status === 200 && publicAnna.data.items.every((item) => item.masterSlug === "anna-smirnova"),
  `услуг: Анна — ${publicAnna.data?.items?.length}, Мария — ${publicMaria.data?.items?.length}`,
);
assert(
  "скрытых услуг в витрине нет",
  publicAnna.data.items.length === own.data.items.filter((item) => item.active).length,
  `витрина=${publicAnna.data.items.length}, активных=${own.data.items.filter((item) => item.active).length}`,
);

/* --- API: создание, правка, скрытие, удаление --- */
const created = await apiAs(master, "/cabinet/services", {
  method: "POST",
  body: { name: "Укрепление гелем", category: "Покрытие", durationMinutes: 45, price: 1200 },
});
assert("мастер создаёт услугу", created.status === 201 && created.data.service?.name === "Укрепление гелем", `status=${created.status}`);
const newId = created.data.service.id;
assert("услуга сразу активна", created.data.service.active === true && created.data.service.bookingsCount === 0);

const patched = await apiAs(master, `/cabinet/services/${newId}`, {
  method: "PATCH",
  body: { price: 1400, durationMinutes: 60 },
});
assert(
  "цена и длительность меняются",
  patched.status === 200 && patched.data.service.price === 1400 && patched.data.service.durationMinutes === 60,
  `${patched.data.service?.price} ₽ / ${patched.data.service?.durationMinutes} мин`,
);

const badPrice = await apiAs(master, `/cabinet/services/${newId}`, { method: "PATCH", body: { price: -100 } });
assert("отрицательная цена отклоняется", badPrice.status === 400, `status=${badPrice.status}`);

// Длительность нового окна влияет на расчёт слотов: 60 минут занимают больше времени.
const slotsBefore = await api(`/masters/anna-smirnova/slots?date=${SLOT_DATE}&serviceId=anna-smirnova-s7`); // 10 мин
const slotsAfter = await api(`/masters/anna-smirnova/slots?date=${SLOT_DATE}&serviceId=${newId}`); // 60 мин
assert(
  "длительность услуги влияет на свободные окна",
  slotsBefore.status === 200 && slotsAfter.status === 200 && slotsAfter.data.slots.length < slotsBefore.data.slots.length,
  `окон по 10 мин: ${slotsBefore.data?.slots?.length}, по 60 мин: ${slotsAfter.data?.slots?.length}`,
);

const hidden = await apiAs(master, `/cabinet/services/${newId}`, { method: "PATCH", body: { active: false } });
assert("услугу можно скрыть", hidden.status === 200 && hidden.data.service.active === false);
const publicAfterHide = await api("/services?master=anna-smirnova");
assert("скрытая услуга пропадает из витрины", !publicAfterHide.data.items.some((item) => item.id === newId));
const slotsHidden = await api(`/masters/anna-smirnova/slots?date=${DATE}&serviceId=${newId}`);
assert("по скрытой услуге окна не считаются", slotsHidden.status === 404, `status=${slotsHidden.status}`);

const removed = await apiAs(master, `/cabinet/services/${newId}`, { method: "DELETE" });
assert("услугу без записей можно удалить", removed.status === 200 && removed.data.ok === true, `status=${removed.status}`);

const usedRemoved = await apiAs(master, "/cabinet/services/anna-smirnova-s2", { method: "DELETE" });
assert(
  "услугу с записями удалить нельзя",
  usedRemoved.status === 409 && usedRemoved.data.error === "service_in_use",
  `status=${usedRemoved.status} ${usedRemoved.data?.error}`,
);

/* --- API: чужие услуги недоступны --- */
const foreignPatch = await apiAs(master, "/cabinet/services/ekaterina-vlasova-s2", {
  method: "PATCH",
  body: { price: 1 },
});
assert("чужую услугу нельзя изменить", foreignPatch.status === 403, `status=${foreignPatch.status}`);
const foreignDelete = await apiAs(master, "/cabinet/services/ekaterina-vlasova-s2", { method: "DELETE" });
assert("чужую услугу нельзя удалить", foreignDelete.status === 403, `status=${foreignDelete.status}`);
const foreignSlots = await api(`/masters/maria-ivanova/slots?date=${DATE}&serviceId=anna-smirnova-s2`);
assert("окна по чужой услуге не считаются", foreignSlots.status === 404, `status=${foreignSlots.status}`);
const foreignBooking = await api("/bookings", {
  method: "POST",
  body: {
    masterSlug: "maria-ivanova",
    serviceId: "anna-smirnova-s2",
    dateISO: DATE,
    startMinutes: 780,
    clientName: "Тест Тестов",
    clientPhone: "+79990001122",
  },
});
assert("записаться на чужую услугу нельзя", foreignBooking.status === 404, `status=${foreignBooking.status}`);

/* --- Интерфейс: список из базы, правка, скрытие --- */
const page = makeDom("/pro/services", { session: master });
await wait(1600);
const text = rootText(page.dom);
assert("прайс кабинета пришёл из базы", text.includes(`${own.data.total} услуг`) && text.includes(`активных ${own.data.activeCount}`), text.slice(0, 120));
assert("в таблице видна услуга мастера", Boolean(page.dom.window.document.querySelector("[data-service-row='anna-smirnova-s1']")));
assert(
  "в таблице видно количество записей по услуге",
  text.includes("записей:"),
  "услуг с записями: " + own.data.items.filter((item) => item.bookingsCount > 0).length,
);

// Категория создаётся прямо из корня раздела отдельной кнопкой и модальным окном.
const addCategoryButton = page.dom.window.document.querySelector("[data-action='add-category']");
assert("в корне услуг есть отдельная кнопка добавления категории", Boolean(addCategoryButton));
addCategoryButton?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(100);
const categoryForm = page.dom.window.document.querySelector("[data-category-form]");
const categoryInputs = [...(categoryForm?.querySelectorAll("input") ?? [])];
assert("категория открывается в отдельном модальном окне", Boolean(categoryForm));
assert("модальное окно категории содержит одно текстовое поле", categoryInputs.length === 1, `полей=${categoryInputs.length}`);
assert("форма услуги не открылась вместе с категорией", !page.dom.window.document.querySelector("[data-service-form]"));
setField(page.dom, "Например, Педикюр", "Педикюр");
click(page.dom, "Создать категорию");
await wait(900);

let categoriesAfterCreate = await apiAs(master, "/cabinet/services");
assert(
  "новая категория сохранена отдельно от услуг",
  categoriesAfterCreate.status === 200 && categoriesAfterCreate.data.categories.includes("Педикюр"),
  JSON.stringify(categoriesAfterCreate.data.categories),
);
assert("после сохранения открыт список категорий", rootText(page.dom).includes("Педикюр"));
let createdCategory = categoriesAfterCreate.data.categoryItems.find((category) => category.name === "Педикюр");
assert("категория возвращается с ID для управления", Boolean(createdCategory?.id), createdCategory?.id);

const rivalPhone = `+7993${String(Date.now()).slice(-6)}`;
const rivalOtp = await api("/auth/request-otp", { method: "POST", body: { phone: rivalPhone } });
const rivalRegistration = await api("/auth/verify-otp", {
  method: "POST",
  body: {
    phone: rivalPhone,
    code: rivalOtp.data.devCode,
    mode: "register",
    role: "master",
    name: "Другой мастер",
  },
});
const rivalMaster = { accessToken: rivalRegistration.data.accessToken };
assert("для проверки scope зарегистрирован второй мастер", rivalRegistration.status === 200 && rivalRegistration.data.user?.role === "master");
const foreignCategoryUpdate = await apiAs(rivalMaster, `/cabinet/services/categories/${createdCategory?.id}`, {
  method: "PUT",
  body: { name: "Чужая правка" },
});
const foreignCategoryDelete = await apiAs(rivalMaster, `/cabinet/services/categories/${createdCategory?.id}`, { method: "DELETE" });
assert("другой мастер не может переименовать категорию", foreignCategoryUpdate.status === 403, `status=${foreignCategoryUpdate.status}`);
assert("другой мастер не может удалить категорию", foreignCategoryDelete.status === 403, `status=${foreignCategoryDelete.status}`);

const duplicateCategory = await apiAs(master, "/cabinet/service-categories", {
  method: "POST",
  body: { name: " педикюр " },
});
assert("повтор категории не создаёт дубль", duplicateCategory.status === 409, `status=${duplicateCategory.status}`);
const invalidCategory = await apiAs(master, "/cabinet/service-categories", { method: "POST", body: { name: " " } });
assert("пустое название категории отклоняется", invalidCategory.status === 400, `status=${invalidCategory.status}`);

// В форме услуги остался только список существующих категорий мастера.
click(page.dom, "Добавить услугу");
await wait(300);
const categorySelect = page.dom.window.document.querySelector("[data-field='service-category']");
const categoryValues = [...(categorySelect?.querySelectorAll("option") ?? [])].map((option) => option.value);
assert(
  "в списке есть существующие категории текущего мастера",
  own.data.categories.every((category) => categoryValues.includes(category)) && categoryValues.includes("Педикюр"),
  categoryValues.join(", "),
);
assert("в форме услуги нет пункта создания категории", !categoryValues.includes("__new_category__"));
assert("в форме услуги нет дополнительного поля для категории", !page.dom.window.document.querySelector("[data-field='service-new-category']"));
if (categorySelect) {
  Object.getOwnPropertyDescriptor(page.dom.window.HTMLSelectElement.prototype, "value").set.call(categorySelect, "Педикюр");
  categorySelect.dispatchEvent(new page.dom.window.Event("change", { bubbles: true }));
}
setField(page.dom, "Название услуги", "Педикюр комбинированный");
setField(page.dom, "Длительность, мин", "75");
setField(page.dom, "Цена, ₽", "2600");
clickActionIn(page.dom, "Новая услуга", "Создать услугу");
await wait(1200);

const afterCreate = await apiAs(master, "/cabinet/services");
const uiCreated = afterCreate.data.items.find((item) => item.name === "Педикюр комбинированный");
assert(
  "услуга выбрала категорию, созданную в корне раздела",
  Boolean(uiCreated) && uiCreated.price === 2600 && uiCreated.durationMinutes === 75 && uiCreated.category === "Педикюр",
  uiCreated ? `${uiCreated.category} / ${uiCreated.price} ₽ / ${uiCreated.durationMinutes} мин` : "не найдена",
);

// Категорию с активной услугой удалить нельзя: показываем серверное предупреждение.
const categoriesTabButton = [...page.dom.window.document.querySelectorAll("button")].find(
  (button) => button.textContent?.trim() === "Категории",
);
categoriesTabButton?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(150);
const categoryDeleteButton = page.dom.window.document.querySelector(
  `[data-action='delete-category'][data-category-id='${createdCategory?.id}']`,
);
assert("у категории есть микро-кнопка удаления", Boolean(categoryDeleteButton));
categoryDeleteButton?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(100);
page.dom.window.document.querySelector("[data-action='confirm-delete-category']")?.dispatchEvent(
  new page.dom.window.MouseEvent("click", { bubbles: true }),
);
await wait(700);
const categoryUseWarning = page.dom.window.document.querySelector("[data-category-delete-error]");
assert(
  "категорию с активной услугой нельзя удалить и показано предупреждение",
  categoryUseWarning?.textContent === "Нельзя удалить категорию, пока в ней есть услуги. Пожалуйста, удалите или перенесите услуги в другие разделы",
  categoryUseWarning?.textContent ?? "предупреждение не найдено",
);
page.dom.window.document.querySelector("[data-action='cancel-delete-category']")?.dispatchEvent(
  new page.dom.window.MouseEvent("click", { bubbles: true }),
);
await wait(100);

// Редактирование категории заранее подставляет текущее имя и обновляет связанные услуги.
const categoryEditButton = page.dom.window.document.querySelector(
  `[data-action='edit-category'][data-category-id='${createdCategory?.id}']`,
);
assert("у категории есть микро-кнопка редактирования", Boolean(categoryEditButton));
categoryEditButton?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(100);
const categoryEditInput = page.dom.window.document.querySelector("[data-field='category-name']");
assert("форма редактирования категории подставляет текущее имя", categoryEditInput?.value === "Педикюр", categoryEditInput?.value);
setField(page.dom, "Например, Педикюр", "Педикюр исправленный");
click(page.dom, "Сохранить категорию");
await wait(900);
const categoriesAfterRename = await apiAs(master, "/cabinet/services");
const renamedCategory = categoriesAfterRename.data.categoryItems.find((category) => category.id === createdCategory?.id);
const renamedService = categoriesAfterRename.data.items.find((item) => item.id === uiCreated?.id);
assert(
  "переименование категории сохраняется в кабинете мастера",
  renamedCategory?.name === "Педикюр исправленный" && renamedService?.category === "Педикюр исправленный",
  `категория=${renamedCategory?.name}; услуга=${renamedService?.category}`,
);
const publicServicesAfterRename = await api("/services?master=anna-smirnova");
const publicServiceAfterRename = publicServicesAfterRename.data.items.find((item) => item.id === uiCreated?.id);
assert(
  "новое название категории сразу попадает в публичный прайс API",
  publicServiceAfterRename?.category === "Педикюр исправленный",
  publicServiceAfterRename?.category,
);

const storefrontAfterRename = makeDom("/master/anna-smirnova", { session: null });
await wait(1500);
const storefrontCategory = storefrontAfterRename.dom.window.document.querySelector(
  `[data-master-service='${uiCreated?.id}'] [data-service-category]`,
);
assert(
  "клиентская витрина отображает новое название категории",
  storefrontCategory?.textContent === "Педикюр исправленный",
  storefrontCategory?.textContent ?? "категория не найдена",
);
storefrontAfterRename.dom.window.close();
const servicesTabButton = [...page.dom.window.document.querySelectorAll("button")].find(
  (button) => button.textContent?.trim() === "Услуги",
);
servicesTabButton?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(150);

// Редактирование услуги использует существующие категории без создания на лету.
const createdRow = page.dom.window.document.querySelector(`[data-service-row='${uiCreated?.id}']`);
createdRow?.querySelector("[data-action='edit-service']")?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(120);
const editCategorySelect = page.dom.window.document.querySelector("[data-field='service-category']");
const editCategoryValues = [...(editCategorySelect?.querySelectorAll("option") ?? [])].map((option) => option.value);
assert("редактирование сохраняет выбор существующей категории", editCategorySelect?.value === "Педикюр исправленный");
assert("в редактировании тоже нет создания категории на лету", !editCategoryValues.includes("__new_category__") && !page.dom.window.document.querySelector("[data-field='service-new-category']"));
click(page.dom, "Отмена");
await wait(100);

// Скрытие из интерфейса: клик по чипу «Активна»
const row = page.dom.window.document.querySelector(`[data-service-row='${uiCreated?.id}']`);
const chip = row?.querySelector("[data-action='toggle-active']");
assert("в строке услуги есть переключатель видимости", Boolean(chip));
chip?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(1000);
const afterHide = await apiAs(master, "/cabinet/services");
const uiHidden = afterHide.data.items.find((item) => item.id === uiCreated?.id);
assert("скрытие из интерфейса сохранилось", uiHidden?.active === false, String(uiHidden?.active));

// Удаление услуги с записями из интерфейса: предлагаем скрыть
const usedRow = page.dom.window.document.querySelector("[data-service-row='anna-smirnova-s2']");
const deleteButton = usedRow?.querySelector("[data-action='delete-service']");
assert("в строке есть кнопка удаления", Boolean(deleteButton));
deleteButton?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(900);
const afterDeleteAttempt = rootText(page.dom);
assert(
  "интерфейс предлагает скрыть услугу с записями",
  afterDeleteAttempt.includes("Услугу нельзя удалить"),
  afterDeleteAttempt.slice(0, 100),
);
assert(
  "услуга с записями не удалена",
  (await apiAs(master, "/cabinet/services")).data.items.some((item) => item.id === "anna-smirnova-s2"),
);
click(page.dom, "Оставить как есть");
await wait(100);

// Пустую категорию можно удалить из интерфейса после подтверждения.
click(page.dom, "Добавить категорию");
await wait(100);
setField(page.dom, "Например, Педикюр", "Пустая категория для удаления");
click(page.dom, "Создать категорию");
await wait(900);
const categoriesWithEmpty = await apiAs(master, "/cabinet/services");
const emptyCategory = categoriesWithEmpty.data.categoryItems.find((category) => category.name === "Пустая категория для удаления");
assert("пустая категория создана перед удалением", Boolean(emptyCategory?.id), emptyCategory?.id);
const emptyCategoryDeleteButton = page.dom.window.document.querySelector(
  `[data-action='delete-category'][data-category-id='${emptyCategory?.id}']`,
);
assert("у пустой категории есть кнопка удаления", Boolean(emptyCategoryDeleteButton));
emptyCategoryDeleteButton?.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true }));
await wait(100);
page.dom.window.document.querySelector("[data-action='confirm-delete-category']")?.dispatchEvent(
  new page.dom.window.MouseEvent("click", { bubbles: true }),
);
await wait(900);
const categoriesAfterDelete = await apiAs(master, "/cabinet/services");
assert(
  "пустую категорию можно удалить без остатка",
  !categoriesAfterDelete.data.categoryItems.some((category) => category.id === emptyCategory?.id) &&
    !categoriesAfterDelete.data.categories.includes("Пустая категория для удаления"),
  JSON.stringify(categoriesAfterDelete.data.categories),
);

page.dom.window.close();

/* --- Интерфейс: страница записи показывает прайс мастера --- */
await resetDemo(master);
const bookingSession = await login("+79990001122", "Тест Клиент");
const booking = makeDom("/booking?master=maria-ivanova", { session: bookingSession });
await wait(1400);
const bookingText = rootText(booking.dom);
assert("страница записи подписана мастером", bookingText.includes("Мастер: Мария Иванова"), bookingText.slice(0, 80));
assert(
  "на записи — услуга из прайса этого мастера",
  bookingText.includes("Маникюр") && !bookingText.includes("Услуга не найдена"),
  bookingText.slice(0, 120),
);
const serviceSelect = booking.dom.window.document.querySelector("[data-field='service']");
assert("услугу мастера можно выбрать", Boolean(serviceSelect), serviceSelect ? String(serviceSelect.value) : "нет селекта");

booking.dom.window.close();

console.log(failures === 0 ? "\nУслуги и цены работают на данных базы." : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
