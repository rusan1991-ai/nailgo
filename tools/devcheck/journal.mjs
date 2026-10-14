/** End-to-end journal test: public visibility, admin-only CMS, publish/edit/delete and rendered pages. */
import {
  api,
  apiAs,
  check,
  loginAdmin,
  loginMaster,
  makeDom,
  setField,
  wait,
} from "./harness.mjs";

let failures = 0;
const assert = (label, ok, extra = "") => {
  if (!check(label, ok, extra)) failures += 1;
};

const admin = await loginAdmin();
const master = await loginMaster();
const prefix = `devcheck-journal-${Date.now()}`;
const draftSlug = `${prefix}-draft`;
const updatedSlug = `${prefix}-updated`;
const generatedTitle = "Пробный журнал: уход за ногтями";
const generatedSlugPrefix = "probnyy-zhurnal-uhod-za-nogtyami";
const content = "Первый абзац: проверяем безопасное хранение текста.\n\nВторой абзац не содержит HTML-разметки.";
const createdIds = new Set();

async function removeTestArticles() {
  const list = await apiAs(admin, "/admin/journal?status=all");
  for (const item of list.data?.items ?? []) {
    if (createdIds.has(item.id) || item.slug.startsWith(prefix)) {
      await apiAs(admin, `/admin/journal/${item.id}`, { method: "DELETE" });
    }
  }
  const remaining = await apiAs(admin, "/admin/journal?status=all");
  const leftovers = (remaining.data?.items ?? []).filter((item) => createdIds.has(item.id) || item.slug.startsWith(prefix));
  if (remaining.status !== 200 || leftovers.length > 0) {
    throw new Error(`test articles remained after cleanup: ${JSON.stringify(leftovers.map((item) => item.slug))}`);
  }
}

try {
  /* ------------------------ Public data and access ------------------------ */
  const publicEmpty = await api("/journal");
  assert("публичный список журнала отвечает", publicEmpty.status === 200 && Array.isArray(publicEmpty.data.items));
  assert("публичный список не содержит тело статьи", publicEmpty.status === 200 && !("content" in (publicEmpty.data.items[0] ?? {})));

  const guestAdmin = await api("/admin/journal");
  assert("гость не видит редактор журнала", guestAdmin.status === 401, `status=${guestAdmin.status}`);
  const masterAdmin = await apiAs(master, "/admin/journal");
  assert("мастер не видит редактор журнала", masterAdmin.status === 403, `status=${masterAdmin.status}`);

  const invalid = await apiAs(admin, "/admin/journal", {
    method: "POST",
    body: { title: "x", category: "", content: "коротко", status: "published" },
  });
  assert("сервер валидирует обязательные поля статьи", invalid.status === 400, `status=${invalid.status}`);

  const insecureCover = await apiAs(admin, "/admin/journal", {
    method: "POST",
    body: {
      title: "Проверка небезопасной обложки",
      category: "Тест",
      content,
      coverUrl: "http://example.com/cover.jpg",
    },
  });
  assert("обложка принимает только HTTPS", insecureCover.status === 400, `status=${insecureCover.status}`);

  /* ------------------------- Draft and publishing ------------------------- */
  const created = await apiAs(admin, "/admin/journal", {
    method: "POST",
    body: {
      title: "Проверка журнала Nail 2 Go",
      slug: draftSlug.toUpperCase(),
      category: "Уход",
      excerpt: "Проверка редакторского анонса",
      content,
    },
  });
  const draft = created.data?.article;
  if (draft?.id) createdIds.add(draft.id);
  assert("администратор создаёт черновик", created.status === 201 && draft?.status === "draft", `status=${created.status}`);
  assert("ручной slug нормализуется к нижнему регистру", draft?.slug === draftSlug, String(draft?.slug));
  assert("автор статьи берётся из админской сессии", draft?.createdBy === admin.user.id, String(draft?.createdBy));

  if (draft?.id) {
    const duplicate = await apiAs(admin, "/admin/journal", {
      method: "POST",
      body: { title: "Дубликат ссылки", slug: draftSlug, category: "Тест", content },
    });
    assert("уникальность slug проверяется сервером", duplicate.status === 409 && duplicate.data.error === "slug_taken");

    const draftPublic = await api("/journal");
    assert("черновик не попадает в публичную ленту", !draftPublic.data.items.some((item) => item.slug === draftSlug));
    const hiddenDetail = await api(`/journal/${draftSlug}`);
    assert("черновик нельзя открыть по публичной ссылке", hiddenDetail.status === 404, `status=${hiddenDetail.status}`);

    const emptyPatch = await apiAs(admin, `/admin/journal/${draft.id}`, { method: "PATCH", body: {} });
    assert("пустое обновление отклоняется", emptyPatch.status === 400, `status=${emptyPatch.status}`);

    const published = await apiAs(admin, `/admin/journal/${draft.id}`, {
      method: "PATCH",
      body: { status: "published" },
    });
    assert("публикация фиксирует дату и статус", published.status === 200 && published.data.article.status === "published" && Boolean(published.data.article.publishedAt));

    const publicList = await api(`/journal?category=${encodeURIComponent("Уход")}`);
    assert(
      "опубликованная статья появляется в публичной категории",
      publicList.status === 200 && publicList.data.items.some((item) => item.slug === draftSlug) && publicList.data.categories.includes("Уход"),
    );
    const detail = await api(`/journal/${draftSlug}`);
    assert(
      "публичная страница получает полный текст опубликованной статьи",
      detail.status === 200 && detail.data.article.content === content && detail.data.article.excerpt === "Проверка редакторского анонса",
    );

    const beforePublishedAt = published.data.article.publishedAt;
    const edited = await apiAs(admin, `/admin/journal/${draft.id}`, {
      method: "PATCH",
      body: { excerpt: "Анонс изменён", content: `${content}\n\nДополнительный абзац.` },
    });
    assert("администратор редактирует опубликованный текст", edited.status === 200 && edited.data.article.content.endsWith("Дополнительный абзац."));
    assert("редактирование сохраняет дату публикации", edited.data.article.publishedAt === beforePublishedAt);

    const duplicateSlug = await apiAs(admin, `/admin/journal/${draft.id}`, {
      method: "PATCH",
      body: { slug: updatedSlug },
    });
    assert("slug статьи можно изменить", duplicateSlug.status === 200 && duplicateSlug.data.article.slug === updatedSlug);
    const oldAddress = await api(`/journal/${draftSlug}`);
    const newAddress = await api(`/journal/${updatedSlug}`);
    assert("публичная ссылка следует новому slug", oldAddress.status === 404 && newAddress.status === 200);

    const unpublished = await apiAs(admin, `/admin/journal/${draft.id}`, { method: "PATCH", body: { status: "draft" } });
    assert("снятие с публикации возвращает статью в черновики", unpublished.status === 200 && unpublished.data.article.status === "draft" && unpublished.data.article.publishedAt === null);
    assert("снятая статья снова скрыта публично", (await api(`/journal/${updatedSlug}`)).status === 404);

    const republished = await apiAs(admin, `/admin/journal/${draft.id}`, { method: "PATCH", body: { status: "published" } });
    assert("черновик можно опубликовать повторно", republished.status === 200 && republished.data.article.status === "published");
  }

  /* ----------------------- Automatic Russian slug ----------------------- */
  const generated = await apiAs(admin, "/admin/journal", {
    method: "POST",
    body: { title: generatedTitle, category: "Идеи", excerpt: "", content },
  });
  const generatedArticle = generated.data?.article;
  if (generatedArticle?.id) createdIds.add(generatedArticle.id);
  assert("пустой slug генерируется транслитерацией заголовка", generated.status === 201 && generatedArticle?.slug === generatedSlugPrefix, String(generatedArticle?.slug));
  assert("пустой анонс сохраняется как null", generatedArticle?.excerpt === null, String(generatedArticle?.excerpt));
  if (draft?.id && generatedArticle?.id) {
    const duplicateUpdate = await apiAs(admin, `/admin/journal/${draft.id}`, {
      method: "PATCH",
      body: { slug: generatedArticle.slug },
    });
    assert("обновление не может занять slug другой статьи", duplicateUpdate.status === 409 && duplicateUpdate.data.error === "slug_taken");
    const filteredDrafts = await apiAs(admin, `/admin/journal?status=draft&query=${encodeURIComponent(generatedSlugPrefix)}`);
    assert("администратор фильтрует черновики и поиск", filteredDrafts.status === 200 && filteredDrafts.data.items.some((item) => item.id === generatedArticle.id));

    const removedDraft = await apiAs(admin, `/admin/journal/${draft.id}`, { method: "DELETE" });
    assert("администратор удаляет статью", removedDraft.status === 200 && removedDraft.data.removed === draft.id);
    createdIds.delete(draft.id);
    assert("удалённая статья больше не открывается", (await api(`/journal/${updatedSlug}`)).status === 404);
  }
  if (generatedArticle?.id) {
    const removedGenerated = await apiAs(admin, `/admin/journal/${generatedArticle.id}`, { method: "DELETE" });
    assert("администратор удаляет автогенерированную статью", removedGenerated.status === 200);
    createdIds.delete(generatedArticle.id);
  }

  /* -------------------- Browser views and XSS rendering -------------------- */
  const uiTitle = "Публикация из редактора Nail Go";
  const uiContent = "Абзац из редактора с обычным текстом.\n\n<script>window.__journalInjected = true</script>";
  const adminDom = makeDom("/admin/journal", { session: admin });
  await wait(700);
  setField(adminDom.dom, "Например: Как ухаживать за кутикулой", uiTitle);
  setField(adminDom.dom, "Уход, тренды, идеи…", "Статьи");
  setField(adminDom.dom, "Напишите статью. Абзацы разделяйте пустой строкой.", uiContent);
  adminDom.dom.window.document.querySelector('[data-action="publish-article"]')?.click();
  await wait(700);
  const uiList = await apiAs(admin, "/admin/journal?status=all");
  const uiArticle = uiList.data.items.find((item) => item.title === uiTitle);
  if (uiArticle?.id) createdIds.add(uiArticle.id);
  assert("админская форма создаёт и публикует статью", Boolean(uiArticle?.id) && uiArticle.status === "published", JSON.stringify(uiArticle?.status));
  assert("страница админки подтверждает сохранение", (adminDom.dom.window.document.getElementById("root")?.textContent ?? "").includes("Статья опубликована"));
  if (uiArticle?.id) {
    const editButton = adminDom.dom.window.document.querySelector(`[data-action="edit-${uiArticle.id}"]`);
    assert("список открывает опубликованную статью в редакторе", Boolean(editButton));
    editButton?.click();
    await wait(100);
    const updatedTitle = `${uiTitle} — исправлено`;
    setField(adminDom.dom, "Например: Как ухаживать за кутикулой", updatedTitle);
    const saveChanges = adminDom.dom.window.document.querySelector('[data-action="save-draft"]');
    assert("сохранение опубликованной статьи не маскируется под черновик", saveChanges?.textContent?.includes("Сохранить изменения"));
    saveChanges?.click();
    await wait(600);
    const refreshed = await apiAs(admin, "/admin/journal?status=all");
    const persistedArticle = refreshed.data.items.find((item) => item.id === uiArticle.id);
    assert("редактирование сохраняет опубликованный статус", persistedArticle?.status === "published" && persistedArticle?.title === updatedTitle);
  }
  adminDom.dom.window.close();

  if (uiArticle) {
    const journalDom = makeDom("/journal", { session: admin });
    await wait(650);
    const card = journalDom.dom.window.document.querySelector(`[data-journal-article="${uiArticle.slug}"]`);
    assert("публичная витрина рисует карточку из API", Boolean(card), uiArticle.slug);
    journalDom.dom.window.close();

    const detailDom = makeDom(`/journal/${encodeURIComponent(uiArticle.slug)}`, { session: admin });
    await wait(650);
    const detailRoot = detailDom.dom.window.document.querySelector(`[data-journal-detail="${uiArticle.slug}"]`);
    assert("публичный роут открывает статью", Boolean(detailRoot));
    assert("содержимое выводится текстом, а не исполняется как HTML", Boolean(detailRoot?.textContent?.includes("window.__journalInjected")) && !detailRoot?.querySelector("script"));
    detailDom.dom.window.close();

    const homeDom = makeDom("/", { session: admin });
    await wait(1400);
    assert("главная показывает только реальные опубликованные материалы", Boolean(homeDom.dom.window.document.querySelector('[data-block="home-journal"]')));
    homeDom.dom.window.close();
  }
} catch (error) {
  failures += 1;
  console.error("FAIL journal devcheck threw:", error);
} finally {
  try {
    await removeTestArticles();
  } catch (error) {
    failures += 1;
    console.error("FAIL journal cleanup:", error);
  }
}

console.log(failures === 0 ? "\nJournal: все проверки пройдены." : `\nJournal: провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
