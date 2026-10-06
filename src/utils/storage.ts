/**
 * Безопасная обёртка над localStorage.
 *
 * Прямое обращение к `window.localStorage` выбрасывает исключение, когда
 * хранилище недоступно: приватный режим Safari, заблокированные cookies,
 * iframe без allow-same-origin (например, окно предпросмотра) и т.п.
 * Из-за такого исключения React размонтирует всё дерево — и пользователь
 * видит пустую белую страницу. Здесь мы всегда падаем обратно в память.
 */

const memory = new Map<string, string>();

function localStorageOrNull(): Storage | null {
  try {
    const storage = window.localStorage;
    // Проверяем, что хранилище действительно доступно на запись.
    const probe = "__nailgo_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export const safeStorage = {
  get(key: string): string | null {
    const storage = localStorageOrNull();
    if (!storage) return memory.get(key) ?? null;
    try {
      return storage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },

  set(key: string, value: string): void {
    memory.set(key, value);
    const storage = localStorageOrNull();
    if (!storage) return;
    try {
      storage.setItem(key, value);
    } catch {
      /* остаёмся на копии в памяти */
    }
  },

  remove(key: string): void {
    memory.delete(key);
    const storage = localStorageOrNull();
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      /* остаёмся на копии в памяти */
    }
  },
};
