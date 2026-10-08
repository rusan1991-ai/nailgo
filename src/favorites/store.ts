/**
 * Избранное как общее состояние приложения.
 *
 * Сердечко стоит на карточках в разных разделах, поэтому список слагов живёт
 * в одном месте и подписывается через useSyncExternalStore: нажал на главной —
 * на странице поиска сердечко уже красное, без перезагрузки данных каталога.
 *
 * Гость сердечки видит, но добавление требует входа — клиент это показывает
 * подсказкой и уводит на форму входа.
 */
import { useEffect, useSyncExternalStore } from "react";
import { fetchFavoriteSlugs, addFavorite, removeFavorite } from "../api/favorites";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type State = {
  /** Чей это список: телефон владельца сессии. Гость — null. */
  owner: string | null;
  slugs: string[];
  status: "idle" | "loading" | "ready" | "guest" | "offline";
  pending: string[];
};

let state: State = { owner: null, slugs: [], status: "idle", pending: [] };
const listeners = new Set<() => void>();

function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): State {
  return state;
}

async function loadSlugs(owner: string) {
  emit({ owner, status: "loading", pending: [] });
  try {
    const slugs = await fetchFavoriteSlugs();
    if (state.owner !== owner) return;
    emit({ slugs, status: "ready" });
  } catch (error) {
    if (state.owner !== owner) return;
    // Гость и «API недоступен» — разные состояния: в первом нужен вход.
    const guest = error instanceof ApiError && (error.status === 401 || error.status === 403);
    emit({ slugs: [], status: guest ? "guest" : "offline" });
  }
}

/** Сбросить состояние при смене пользователя (вход, выход, другой номер). */
export function resetFavorites() {
  emit({ owner: null, slugs: [], status: "idle", pending: [] });
}

export type FavoritesStore = {
  slugs: string[];
  status: State["status"];
  /** Мастер в избранном. */
  has: (slug: string) => boolean;
  /** Ждём ответа сервера по этому мастеру. */
  isPending: (slug: string) => boolean;
  /** Переключить: добавить или убрать. Гость получит `needLogin: true`. */
  toggle: (slug: string) => Promise<{ ok: boolean; needLogin: boolean; favorited: boolean }>;
};

export function useFavorites(): FavoritesStore {
  const { user, ready } = useAuth();
  const owner = user?.phone ?? null;
  const current = useSyncExternalStore(subscribe, snapshot);

  useEffect(() => {
    if (!ready) return;
    if (!owner) {
      if (state.owner !== null || state.status !== "idle") resetFavorites();
      return;
    }
    if (state.owner !== owner) void loadSlugs(owner);
  }, [owner, ready]);

  return {
    slugs: current.slugs,
    status: current.status,
    has: (slug) => current.slugs.includes(slug),
    isPending: (slug) => current.pending.includes(slug),
    toggle: async (slug) => {
      if (!owner) return { ok: false, needLogin: true, favorited: false };

      const wasFavorite = state.slugs.includes(slug);
      // Оптимистично: сердечко откликается сразу, запрос догоняет.
      emit({
        slugs: wasFavorite ? state.slugs.filter((item) => item !== slug) : [...state.slugs, slug],
        pending: [...state.pending, slug],
      });

      try {
        if (wasFavorite) await removeFavorite(slug);
        else await addFavorite(slug);
        emit({ pending: state.pending.filter((item) => item !== slug) });
        return { ok: true, needLogin: false, favorited: !wasFavorite };
      } catch (error) {
        if (state.owner !== owner) return { ok: false, needLogin: false, favorited: wasFavorite };

        // Возвращаем как было: интерфейс не должен врать про избранное.
        emit({
          slugs: wasFavorite ? [...state.slugs, slug] : state.slugs.filter((item) => item !== slug),
          pending: state.pending.filter((item) => item !== slug),
        });
        const guest = error instanceof ApiError && (error.status === 401 || error.status === 403);
        return { ok: false, needLogin: guest, favorited: wasFavorite };
      }
    },
  };
}
